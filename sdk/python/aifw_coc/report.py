"""Signing a sub-agent's result report (SW-1.13).

The agent signs with its **own** key  -  the one whose public half is registered as the agent's
``PublicKeyPem``  -  over a message that binds the leg id **and** the voucher's nonce, so a report cannot be
lifted from one leg to another::

    orderLegId + "\\n" + nonce + "\\n" + state + "\\n" + detail
"""

from __future__ import annotations

import secrets
from typing import Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, utils

from .voucher import _raw_to_der


def canonical_report(order_leg_id: str, nonce: str, state: str, detail: Optional[str] = None) -> str:
    """The exact message both sides sign."""
    return "\n".join([order_leg_id or "", nonce or "", state or "", detail or ""])


def new_key_pair() -> tuple[str, str]:
    """A fresh P-256 key pair for an agent: ``(private_pem, public_pem)``."""
    key = ec.generate_private_key(ec.SECP256R1())
    private_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")
    public_pem = key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("ascii")
    return private_pem, public_pem


def new_nonce() -> str:
    """A nonce for a leg. The platform generates the nonce for its own vouchers."""
    return secrets.token_hex(16)


class ReportSigner:
    """Signs result reports with the agent's own key."""

    def __init__(self, private_key_pem: str) -> None:
        self._key = serialization.load_pem_private_key(private_key_pem.encode("ascii"), password=None)
        self.public_key_pem = self._key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode("ascii")

    def sign(self, order_leg_id: str, nonce: str, state: str, detail: Optional[str] = None) -> str:
        """Sign a report; base64 DER, which is what the platform accepts."""
        message = canonical_report(order_leg_id, nonce, state, detail).encode("utf-8")
        signature = self._key.sign(message, ec.ECDSA(hashes.SHA256()))
        import base64

        return base64.b64encode(signature).decode("ascii")


def verify_report(
    public_key_pem: str,
    order_leg_id: str,
    nonce: str,
    state: str,
    detail: Optional[str],
    signature_b64: str,
) -> bool:
    """Verify a report the way the platform does (useful for an agent's own tests)."""
    import base64

    try:
        key = serialization.load_pem_public_key(public_key_pem.encode("ascii"))
        signature = base64.b64decode(signature_b64)
        message = canonical_report(order_leg_id, nonce, state, detail).encode("utf-8")
        key.verify(_raw_to_der(signature), message, ec.ECDSA(hashes.SHA256()))
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False
