"""Verifies the Python verifier against a **platform-issued** voucher.

Runs the same shared vector as the .NET SDK tests (``sdk/testdata/voucher-vector.json``), so a pass here
means both independent implementations agree with the platform  -  not merely with themselves.

    python -m unittest discover -s sdk/python/tests -v
"""

from __future__ import annotations

import json
import os
import unittest
from datetime import datetime, timedelta, timezone

from aifw_coc import (
    Rejection,
    ReportSigner,
    TrustAnchorKey,
    VoucherVerifier,
    canonical_report,
    fingerprint,
    hash_payload,
    new_key_pair,
    new_nonce,
    verify_report,
)


def _find_vector() -> dict:
    here = os.path.dirname(os.path.abspath(__file__))
    while here and not os.path.exists(os.path.join(here, "AGENTS.md")):
        here = os.path.dirname(here)
    if not here:
        raise RuntimeError("repo root not found (no AGENTS.md above this file)")
    with open(os.path.join(here, "sdk", "testdata", "voucher-vector.json"), encoding="utf-8") as handle:
        return json.load(handle)


VECTOR = _find_vector()


def _verifier() -> VoucherVerifier:
    return VoucherVerifier([
        TrustAnchorKey(kid=VECTOR["kid"], algorithm="ES256", public_key_pem=VECTOR["publicKeyPem"]),
    ])


class VoucherVerificationTests(unittest.TestCase):
    def test_platform_issued_voucher_verifies_offline(self) -> None:
        result = _verifier().verify(
            VECTOR["token"],
            expected_sub_agent_id=VECTOR["claims"]["subAgentId"],
            payload=VECTOR["payload"],
        )

        self.assertTrue(result.ok, result.error)
        claims = result.claims
        self.assertEqual(VECTOR["claims"]["orderLegId"], claims.order_leg_id)
        self.assertEqual(VECTOR["claims"]["hubId"], claims.hub_id)
        self.assertEqual(VECTOR["claims"]["skillId"], claims.skill_id)
        self.assertEqual(VECTOR["claims"]["nonce"], claims.nonce)
        self.assertEqual(VECTOR["claims"]["policyVersion"], claims.policy_version)
        # The digest is computed by this SDK and must equal the one the platform signed.
        self.assertEqual(VECTOR["claims"]["payloadHash"], hash_payload(VECTOR["payload"]))

    def test_tampered_voucher_is_refused(self) -> None:
        self.assertEqual(Rejection.BAD_SIGNATURE, _verifier().verify(VECTOR["tamperedToken"]).rejection)

    def test_expired_voucher_is_refused(self) -> None:
        self.assertEqual(Rejection.EXPIRED, _verifier().verify(VECTOR["expiredToken"]).rejection)

    def test_voucher_for_another_agent_is_refused(self) -> None:
        result = _verifier().verify(VECTOR["token"], expected_sub_agent_id="someone-else")

        self.assertEqual(Rejection.WRONG_SUB_AGENT, result.rejection)

    def test_voucher_for_another_payload_is_refused(self) -> None:
        result = _verifier().verify(VECTOR["token"], payload='{"target":"node-2"}')

        self.assertEqual(Rejection.PAYLOAD_MISMATCH, result.rejection)

    def test_stale_policy_version_is_refused(self) -> None:
        issued = VECTOR["claims"]["policyVersion"]
        verifier = _verifier()

        self.assertEqual(Rejection.STALE_POLICY, verifier.verify(VECTOR["token"], current_policy_version=issued + 1).rejection)
        self.assertTrue(verifier.verify(VECTOR["token"], current_policy_version=issued).ok)

    def test_unknown_key_is_refused(self) -> None:
        stranger = VoucherVerifier([
            TrustAnchorKey(kid="some-other-key", algorithm="ES256", public_key_pem=VECTOR["publicKeyPem"]),
        ])

        self.assertEqual(Rejection.UNKNOWN_KEY, stranger.verify(VECTOR["token"]).rejection)

    def test_malformed_input_is_refused(self) -> None:
        verifier = _verifier()

        self.assertEqual(Rejection.MALFORMED, verifier.verify(None).rejection)
        self.assertEqual(Rejection.MALFORMED, verifier.verify("not-a-token").rejection)
        self.assertEqual(Rejection.MALFORMED, verifier.verify("a.b").rejection)
        self.assertEqual(Rejection.MALFORMED, verifier.verify("!!!.???.***").rejection)

    def test_unsupported_algorithm_is_refused_before_any_signature_work(self) -> None:
        import base64

        header = base64.urlsafe_b64encode(b'{"alg":"none","kid":"x"}').rstrip(b"=").decode()
        payload = base64.urlsafe_b64encode(b"{}").rstrip(b"=").decode()

        self.assertEqual(Rejection.UNSUPPORTED_ALGORITHM, _verifier().verify(f"{header}.{payload}.AAAA").rejection)

    def test_fingerprint_is_a_colon_separated_sha256(self) -> None:
        pairs = fingerprint(VECTOR["publicKeyPem"]).split(":")

        self.assertEqual(32, len(pairs))
        self.assertTrue(all(len(pair) == 2 for pair in pairs))

    def test_from_trust_anchor_json_builds_a_working_verifier(self) -> None:
        anchor = json.dumps({"keys": [
            {"kid": VECTOR["kid"], "algorithm": "ES256", "publicKeyPem": VECTOR["publicKeyPem"],
             "fingerprintSha256": "", "signing": True, "retired": False},
        ]})

        verifier = VoucherVerifier.from_trust_anchor_json(anchor)

        self.assertEqual([VECTOR["kid"]], verifier.kids)
        self.assertTrue(verifier.verify(VECTOR["token"]).ok)


class ReportSignatureTests(unittest.TestCase):
    def test_the_vector_report_signature_verifies(self) -> None:
        report = VECTOR["report"]

        self.assertTrue(verify_report(
            VECTOR["publicKeyPem"],
            VECTOR["claims"]["orderLegId"],
            VECTOR["claims"]["nonce"],
            report["state"],
            report["detail"],
            report["signature"],
        ))

    def test_a_fresh_report_round_trips(self) -> None:
        private_pem, public_pem = new_key_pair()
        signer = ReportSigner(private_pem)
        nonce = new_nonce()

        self.assertEqual(public_pem, signer.public_key_pem)
        signature = signer.sign("leg-1", nonce, "succeeded", "done")

        self.assertTrue(verify_report(public_pem, "leg-1", nonce, "succeeded", "done", signature))
        # The binding holds: changing any part of the message breaks it.
        self.assertFalse(verify_report(public_pem, "leg-1", nonce, "failed", "done", signature))
        self.assertFalse(verify_report(public_pem, "leg-1", "other-nonce", "succeeded", "done", signature))
        self.assertFalse(verify_report(public_pem, "leg-2", nonce, "succeeded", "done", signature))

    def test_the_canonical_message_is_pinned(self) -> None:
        self.assertEqual("leg-1\nnonce-1\nsucceeded\ndone",
                         canonical_report("leg-1", "nonce-1", "succeeded", "done"))
        self.assertEqual("leg-1\nnonce-1\nsucceeded\n",
                         canonical_report("leg-1", "nonce-1", "succeeded", None))

    def test_the_verifier_honours_an_explicit_now(self) -> None:
        # Expiry is a wall-clock decision, so it is testable without waiting.
        verifier = _verifier()
        claims = verifier.verify(VECTOR["token"]).claims

        self.assertTrue(verifier.verify(VECTOR["token"], now=claims.expires_at - timedelta(days=1)).ok)
        self.assertEqual(
            Rejection.EXPIRED,
            verifier.verify(VECTOR["token"], now=claims.expires_at + timedelta(seconds=1)).rejection,
        )


if __name__ == "__main__":
    unittest.main()
