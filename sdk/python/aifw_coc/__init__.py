"""AI-FW **Chain of Command** SDK.

Create hub agents and sub-agents, manage a swarm, send orders  -  and, on the agent side, verify command
vouchers **offline** and report signed results.

    from aifw_coc import CoCClient, VoucherVerifier, ReportSigner

    # Operator: create a swarm and send an order
    operator = CoCClient("https://agent-trust.example.com", api_key=OWNER_KEY)
    swarm = operator.create_swarm("fleet-hub-1", "Fleet",
                                  sub_agent_ids=["fleet-sub-1"], skills=["FleetRotateNote"])
    order = operator.send_order(swarm["swarmId"], "FleetRotateNote", '{"target":"node-1"}')

    # Sub-agent: verify the voucher offline, then report the outcome
    verifier = VoucherVerifier.from_trust_anchor_json(ANCHOR_JSON)
    result = verifier.verify(VOUCHER, expected_sub_agent_id="fleet-sub-1", payload=payload)
    if result.ok:
        signer = ReportSigner(AGENT_PRIVATE_KEY_PEM)
        agent.report_result(result.claims.order_leg_id, "succeeded", "rotated",
                            signer.sign(result.claims.order_leg_id, result.claims.nonce, "succeeded", "rotated"))

The wire contracts are documented in ``docs/chain-of-command.md``. Requires ``cryptography``.
"""

from .client import CoCAuthorization, CoCClient, CoCError, CoCLeg, CoCOrderResult
from .report import ReportSigner, canonical_report, new_key_pair, new_nonce, verify_report
from .voucher import (
    Rejection,
    TrustAnchorKey,
    VoucherClaims,
    VoucherVerification,
    VoucherVerifier,
    b64url_decode,
    b64url_encode,
    fingerprint,
    hash_payload,
)

__version__ = "1.0.0"

__all__ = [
    "CoCAuthorization",
    "CoCClient",
    "CoCError",
    "CoCLeg",
    "CoCOrderResult",
    "Rejection",
    "ReportSigner",
    "TrustAnchorKey",
    "VoucherClaims",
    "VoucherVerification",
    "VoucherVerifier",
    "b64url_decode",
    "b64url_encode",
    "canonical_report",
    "fingerprint",
    "hash_payload",
    "new_key_pair",
    "new_nonce",
    "verify_report",
]
