"""A client for the Chain-of-Command and swarm surface.

Covers both sides: an **operator** creating and managing swarms, and an **agent** reading its own view,
verifying vouchers, confirming authorisations and reporting results. Standard library only  -  no ``requests``
dependency  -  so an agent author can vendor it.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Iterable, Optional
from urllib.parse import quote

from .voucher import TrustAnchorKey


class CoCError(Exception):
    """A failed CoC call, with the platform's own error code and message."""

    def __init__(self, status: int, code: Optional[int], message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code


@dataclass(frozen=True)
class CoCLeg:
    sub_agent_id: str
    order_leg_id: str
    task_id: str
    state: str
    error: Optional[str]


@dataclass(frozen=True)
class CoCOrderResult:
    swarm_order_id: str
    total: int
    succeeded: int
    failed: int
    rejected: int
    relayed: int
    stopped_early: bool
    replayed: bool
    legs: list[CoCLeg]


@dataclass(frozen=True)
class CoCAuthorization:
    """Whether a leg's authorisation still stands (the live callback)."""

    order_leg_id: str
    valid: bool
    revoked: bool
    status: str
    skill_id: str
    hub_id: str
    policy_version: int
    expires_at: str


class CoCClient:
    """Talks to the platform over HTTP.

    ``api_key`` is the credential to act with. An **agent API key** authenticates as the agent it belongs
    to  -  never as the key's label  -  which is what the agent-facing endpoints require.
    """

    def __init__(self, base_url: str, api_key: Optional[str] = None, timeout: float = 30.0) -> None:
        self._base = base_url.rstrip("/") + "/"
        self._api_key = api_key
        self._timeout = timeout

    # ── agent side ──────────────────────────────────────────────────────────────────────────

    def get_status(self) -> dict[str, Any]:
        """The caller's own versioned view: owner, hub, swarm, granted skills, policy generation."""
        return self._request("GET", "agent/status")

    def get_trust_anchor(self) -> list[TrustAnchorKey]:
        """Fetch the voucher trust anchor. Verify a fingerprint out of band before pinning it."""
        body = self._request("GET", "agent/trust-anchor")
        return [TrustAnchorKey.from_json(entry) for entry in body.get("keys", [])]

    def get_authorization(self, order_leg_id: str) -> CoCAuthorization:
        """The live confirmation a ``callback-required`` swarm needs before executing."""
        body = self._request("GET", f"a2a/v1/authorizations/{quote(order_leg_id, safe='')}")
        return CoCAuthorization(
            order_leg_id=body.get("orderLegId", order_leg_id),
            valid=bool(body.get("valid", False)),
            revoked=bool(body.get("revoked", False)),
            status=body.get("status", ""),
            skill_id=body.get("skillId", ""),
            hub_id=body.get("hubId", ""),
            policy_version=int(body.get("policyVersion", 0)),
            expires_at=body.get("expiresAt", ""),
        )

    def report_result(
        self, order_leg_id: str, state: str, detail: Optional[str] = None, signature: Optional[str] = None
    ) -> dict[str, Any]:
        """Report a leg's outcome. Sign it with :class:`ReportSigner`  -  an unsigned report is recorded as
        ``UNVERIFIED`` rather than as success."""
        return self._request(
            "POST",
            f"a2a/v1/swarm/legs/{quote(order_leg_id, safe='')}:report",
            {"state": state, "detail": detail, "signature": signature},
        )

    # ── operator side ───────────────────────────────────────────────────────────────────────

    def create_swarm(
        self,
        hub_agent_id: str,
        name: str,
        sub_agent_ids: Optional[Iterable[str]] = None,
        skills: Optional[Iterable[str]] = None,
    ) -> dict[str, Any]:
        """Create a swarm for a hub. Re-creating the same hub + name is idempotent."""
        return self._request(
            "POST",
            f"agent/{quote(hub_agent_id, safe='')}/swarm",
            {
                "name": name,
                "subAgentIds": list(sub_agent_ids or []),
                "skills": list(skills or []),
            },
        )

    def list_swarms(self, hub_agent_id: str) -> dict[str, Any]:
        return self._request("GET", f"agent/{quote(hub_agent_id, safe='')}/swarm")

    def list_members(self, hub_agent_id: str, swarm_id: str) -> dict[str, Any]:
        """Members, narrowed to what the caller is entitled to see."""
        return self._request("GET", f"agent/{quote(hub_agent_id, safe='')}/swarm/{swarm_id}/members")

    def add_member(self, hub_agent_id: str, swarm_id: str, sub_agent_id: str) -> dict[str, Any]:
        return self._request(
            "POST",
            f"agent/{quote(hub_agent_id, safe='')}/swarm/{swarm_id}/members",
            {"subAgentId": sub_agent_id},
        )

    def record_consent(
        self, hub_agent_id: str, swarm_id: str, sub_agent_id: str, expires_at: Optional[str] = None
    ) -> dict[str, Any]:
        """Record consent for a mixed-ownership member. Omit ``expires_at`` to use the platform's
        ``swarm_consent_valid_days`` (0 = never)."""
        return self._request(
            "POST",
            f"agent/{quote(hub_agent_id, safe='')}/swarm/{swarm_id}/members/{quote(sub_agent_id, safe='')}/consent",
            {"expiresAt": expires_at},
        )

    def remove_member(self, hub_agent_id: str, swarm_id: str, sub_agent_id: str) -> dict[str, Any]:
        return self._request(
            "DELETE",
            f"agent/{quote(hub_agent_id, safe='')}/swarm/{swarm_id}/members/{quote(sub_agent_id, safe='')}",
        )

    def disband_swarm(self, hub_agent_id: str, swarm_id: str) -> dict[str, Any]:
        return self._request("POST", f"agent/{quote(hub_agent_id, safe='')}/swarm/{swarm_id}/disband")

    def grant_capability(self, hub_agent_id: str, swarm_id: str, capability: str) -> dict[str, Any]:
        return self._request(
            "POST",
            f"agent/{quote(hub_agent_id, safe='')}/swarm/{swarm_id}/capabilities",
            {"capability": capability},
        )

    def revoke_capability(self, hub_agent_id: str, swarm_id: str, capability: str) -> dict[str, Any]:
        return self._request(
            "DELETE",
            f"agent/{quote(hub_agent_id, safe='')}/swarm/{swarm_id}/capabilities/{quote(capability, safe='')}",
        )

    def set_cascade(self, hub_agent_id: str, swarm_id: str, on_suspend: bool, on_revoke: bool) -> dict[str, Any]:
        """Per-swarm cascade policy. Both default to off."""
        return self._request(
            "PUT",
            f"agent/{quote(hub_agent_id, safe='')}/swarm/{swarm_id}/cascade",
            {"onSuspend": on_suspend, "onRevoke": on_revoke},
        )

    def set_voucher_verify(
        self,
        hub_agent_id: str,
        swarm_id: str,
        mode: Optional[str] = None,
        by_skill: Optional[dict[str, str]] = None,
    ) -> dict[str, Any]:
        """SW-1.10a: ``offline`` | ``callback-optional`` | ``callback-required``, with per-skill overrides.

        Owner/admin only  -  the hub cannot set its own posture. An unrecognised mode is refused.
        """
        return self._request(
            "PUT",
            f"agent/{quote(hub_agent_id, safe='')}/swarm/{swarm_id}/voucher-verify",
            {"mode": mode, "bySkill": by_skill},
        )

    def send_order(
        self,
        swarm_id: str,
        skill: str,
        instruction: str,
        fail_fast: bool = False,
        idempotency_key: Optional[str] = None,
    ) -> CoCOrderResult:
        """Send an order from the hub to every consenting member."""
        headers = {"X-Idempotency-Key": idempotency_key} if idempotency_key else None
        body = self._request(
            "POST",
            f"a2a/v1/swarm/{swarm_id}:send",
            {"skill": skill, "instruction": instruction, "failFast": fail_fast},
            headers=headers,
        )
        legs = [
            CoCLeg(
                sub_agent_id=leg.get("subAgentId", ""),
                order_leg_id=leg.get("orderLegId", ""),
                task_id=leg.get("taskId", ""),
                state=leg.get("state", ""),
                error=leg.get("error"),
            )
            for leg in body.get("perSubAgent", [])
        ]
        return CoCOrderResult(
            swarm_order_id=body.get("swarmOrderId", ""),
            total=int(body.get("total", 0)),
            succeeded=int(body.get("succeeded", 0)),
            failed=int(body.get("failed", 0)),
            rejected=int(body.get("rejected", 0)),
            relayed=int(body.get("relayed", 0)),
            stopped_early=bool(body.get("stoppedEarly", False)),
            replayed=bool(body.get("replayed", False)),
            legs=legs,
        )

    def revoke_order(self, order_id: str) -> dict[str, Any]:
        """Revoke what is left of an order. Legs that already ran are left alone."""
        return self._request("POST", f"a2a/v1/swarm/{order_id}:revoke")

    def claim(
        self,
        agent_id: str,
        owner_id: Optional[str] = None,
        owner_group: Optional[str] = None,
        sponsor_code: Optional[str] = None,
    ) -> dict[str, Any]:
        """Claim an agent for the caller (or hand a sponsor code in)."""
        return self._request(
            "POST",
            "agent/claim",
            {"agentId": agent_id, "ownerId": owner_id, "ownerGroup": owner_group, "sponsorCode": sponsor_code},
        )

    def grant_delegation(
        self,
        agent_id: str,
        delegate_id: str,
        skills: Iterable[str],
        max_depth: Optional[int] = None,
        expires_at: Optional[str] = None,
    ) -> dict[str, Any]:
        """Grant a delegation, optionally clamped below ``max_delegation_depth`` and time-bounded."""
        return self._request(
            "POST",
            f"agent/{quote(agent_id, safe='')}/delegations",
            {
                "delegateId": delegate_id,
                "skills": list(skills),
                "maxDepth": max_depth,
                "expiresAt": expires_at,
            },
        )

    # ── plumbing ────────────────────────────────────────────────────────────────────────────

    def _request(
        self,
        method: str,
        path: str,
        body: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> dict[str, Any]:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(self._base + path, data=data, method=method)
        request.add_header("Accept", "application/json")
        if data is not None:
            request.add_header("Content-Type", "application/json")
        if self._api_key:
            request.add_header("Authorization", f"Bearer {self._api_key}")
        for key, value in (headers or {}).items():
            request.add_header(key, value)

        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                text = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            text = error.read().decode("utf-8", errors="replace")
            code, message = _error_parts(text)
            raise CoCError(error.code, code, message or f"HTTP {error.code}") from error
        except urllib.error.URLError as error:
            raise CoCError(0, None, f"Could not reach {self._base}{path}: {error.reason}") from error

        if not text.strip():
            return {}
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return {"raw": text}


def _error_parts(text: str) -> tuple[Optional[int], Optional[str]]:
    """Pull the JSON-RPC ``code`` and ``message`` out of an error body, when it carries them."""
    try:
        document = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return None, None
    code = document.get("code")
    return (int(code) if isinstance(code, int) else None), document.get("message")
