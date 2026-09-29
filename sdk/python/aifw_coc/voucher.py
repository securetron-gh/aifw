"""Voucher verification  -  implemented independently of the .NET SDK, from the wire format.

A voucher is a JWS compact token (RFC 7515): ``base64url(header) . base64url(payload) . base64url(sig)``,
signed ES256 (ECDSA P-256 / SHA-256) in the raw ``r‖s`` form JWS uses. The signer is named by the header's
``kid``, which the verifier must already hold  -  that is what makes verification work offline, with no call
back to the platform.

Two implementations existing (this one and the .NET client) is deliberate: the format is only credible if
it can be implemented from the specification, and both are checked against the same platform-issued vector
in ``sdk/testdata/voucher-vector.json``.
"""

from __future__ import annotations

import base64
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Iterable, Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature


class Rejection(str, Enum):
    """Why a voucher was refused. Specific, so a caller can log and act on the real reason."""

    NONE = "None"
    MALFORMED = "Malformed"
    UNSUPPORTED_ALGORITHM = "UnsupportedAlgorithm"
    UNKNOWN_KEY = "UnknownKey"
    BAD_SIGNATURE = "BadSignature"
    EXPIRED = "Expired"
    WRONG_SUB_AGENT = "WrongSubAgent"
    PAYLOAD_MISMATCH = "PayloadMismatch"
    STALE_POLICY = "StalePolicy"


@dataclass(frozen=True)
class TrustAnchorKey:
    """One entry of ``GET /agent/trust-anchor``."""

    kid: str
    algorithm: str
    public_key_pem: str
    fingerprint_sha256: str = ""
    signing: bool = False
    retired: bool = False

    @classmethod
    def from_json(cls, entry: dict[str, Any]) -> "TrustAnchorKey":
        return cls(
            kid=entry.get("kid", ""),
            algorithm=entry.get("algorithm", ""),
            public_key_pem=entry.get("publicKeyPem", ""),
            fingerprint_sha256=entry.get("fingerprintSha256", ""),
            signing=bool(entry.get("signing", False)),
            retired=bool(entry.get("retired", False)),
        )


@dataclass(frozen=True)
class VoucherClaims:
    order_leg_id: str
    hub_id: str
    sub_agent_id: str
    skill_id: str
    payload_hash: str
    policy_version: int
    issuer: str
    nonce: str
    issued_at: datetime
    expires_at: datetime


@dataclass(frozen=True)
class VoucherVerification:
    ok: bool
    rejection: Rejection
    error: Optional[str]
    claims: Optional[VoucherClaims]


def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(value: str) -> bytes:
    text = value.replace("-", "+").replace("_", "/")
    text += "=" * (-len(text) % 4)
    return base64.b64decode(text)


def hash_payload(payload: Optional[str]) -> str:
    """SHA-256 (hex) of the exact payload bytes  -  the value a voucher binds to."""
    return hashlib.sha256((payload or "").encode("utf-8")).hexdigest()


def fingerprint(public_key_pem: str) -> str:
    """Colon-separated SHA-256 of the key's DER  -  compare this with what the platform published
    out of band before trusting the anchor."""
    key = serialization.load_pem_public_key(public_key_pem.encode("ascii"))
    der = key.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return ":".join(f"{b:02X}" for b in hashlib.sha256(der).digest())


def _raw_to_der(signature: bytes) -> bytes:
    """The voucher's 64-byte ``r‖s`` → the DER form ``cryptography`` verifies."""
    if len(signature) == 64:
        r = int.from_bytes(signature[:32], "big")
        s = int.from_bytes(signature[32:], "big")
        return encode_dss_signature(r, s)
    if signature[:1] == b"\x30":
        return signature
    raise ValueError("Unrecognised ECDSA signature encoding.")


def _parse_time(value: str) -> datetime:
    text = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(text)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


class VoucherVerifier:
    """Verifies command vouchers offline against a pinned trust anchor."""

    def __init__(self, anchor_keys: Iterable[TrustAnchorKey]) -> None:
        self._keys: dict[str, Any] = {}
        for entry in anchor_keys:
            if not entry.kid or not entry.public_key_pem:
                continue
            try:
                self._keys[entry.kid] = serialization.load_pem_public_key(
                    entry.public_key_pem.encode("ascii")
                )
            except (ValueError, TypeError):
                # An unusable anchor entry is simply not a usable key: skip it rather than failing the
                # whole anchor, so one bad row cannot lock an agent out.
                continue

    @classmethod
    def from_trust_anchor_json(cls, trust_anchor_json: str) -> "VoucherVerifier":
        document = json.loads(trust_anchor_json)
        return cls(TrustAnchorKey.from_json(entry) for entry in document.get("keys", []))

    @property
    def kids(self) -> list[str]:
        return sorted(self._keys)

    def verify(
        self,
        token: Optional[str],
        expected_sub_agent_id: Optional[str] = None,
        payload: Optional[str] = None,
        current_policy_version: Optional[int] = None,
        now: Optional[datetime] = None,
    ) -> VoucherVerification:
        """Verify a voucher.

        ``expected_sub_agent_id`` is your own agent id (``subAgentId == self``); ``payload`` is the
        instruction you actually received, so the binding is checked rather than assumed;
        ``current_policy_version`` is what your ``GET /agent/status`` reports.
        """
        if not token:
            return VoucherVerification(False, Rejection.MALFORMED, "A voucher is required.", None)

        parts = token.split(".")
        if len(parts) != 3:
            return VoucherVerification(False, Rejection.MALFORMED, "Not a well-formed voucher token.", None)

        try:
            header = json.loads(b64url_decode(parts[0]))
        except (ValueError, json.JSONDecodeError):
            return VoucherVerification(False, Rejection.MALFORMED, "The voucher header is unreadable.", None)

        algorithm = header.get("alg", "")
        kid = header.get("kid", "")
        if algorithm != "ES256":
            return VoucherVerification(
                False, Rejection.UNSUPPORTED_ALGORITHM, f"Unsupported algorithm '{algorithm}'.", None
            )

        key = self._keys.get(kid)
        if key is None:
            return VoucherVerification(
                False, Rejection.UNKNOWN_KEY, f"Key '{kid}' is not in the trust anchor.", None
            )

        try:
            signature = b64url_decode(parts[2])
            raw_claims = json.loads(b64url_decode(parts[1]))
        except (ValueError, json.JSONDecodeError):
            return VoucherVerification(False, Rejection.MALFORMED, "The voucher is unreadable.", None)

        claims = VoucherClaims(
            order_leg_id=raw_claims.get("orderLegId", ""),
            hub_id=raw_claims.get("hubId", ""),
            sub_agent_id=raw_claims.get("subAgentId", ""),
            skill_id=raw_claims.get("skillId", ""),
            payload_hash=raw_claims.get("payloadHash", ""),
            policy_version=int(raw_claims.get("policyVersion", 0)),
            issuer=raw_claims.get("issuer", ""),
            nonce=raw_claims.get("nonce", ""),
            issued_at=_parse_time(raw_claims.get("issuedAt", "1970-01-01T00:00:00Z")),
            expires_at=_parse_time(raw_claims.get("expiresAt", "1970-01-01T00:00:00Z")),
        )

        # The signature covers the base64url TEXT of header.payload, not the decoded bytes.
        signing_input = f"{parts[0]}.{parts[1]}".encode("ascii")
        try:
            key.verify(_raw_to_der(signature), signing_input, ec.ECDSA(hashes.SHA256()))
        except (InvalidSignature, ValueError):
            return VoucherVerification(
                False, Rejection.BAD_SIGNATURE, "The voucher signature does not verify.", claims
            )

        at = now or datetime.now(timezone.utc)
        if claims.expires_at <= at:
            return VoucherVerification(False, Rejection.EXPIRED, "The voucher has expired.", claims)

        if expected_sub_agent_id and claims.sub_agent_id.lower() != expected_sub_agent_id.lower():
            return VoucherVerification(
                False,
                Rejection.WRONG_SUB_AGENT,
                f"The voucher is addressed to '{claims.sub_agent_id}', not to this agent.",
                claims,
            )

        if payload is not None and claims.payload_hash != hash_payload(payload):
            return VoucherVerification(
                False,
                Rejection.PAYLOAD_MISMATCH,
                "The voucher does not match the instruction it accompanies.",
                claims,
            )

        if current_policy_version is not None and claims.policy_version != current_policy_version:
            return VoucherVerification(
                False,
                Rejection.STALE_POLICY,
                f"Issued against policy version {claims.policy_version}; current is {current_policy_version}.",
                claims,
            )

        return VoucherVerification(True, Rejection.NONE, None, claims)
