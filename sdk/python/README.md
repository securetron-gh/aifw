# AI-FW Chain of Command  -  Python SDK

Create hub agents and sub-agents, manage a swarm, send orders  -  and, on the agent side, verify command
vouchers **offline** and report signed results.

The wire contracts are specified in [`docs/chain-of-command.md`](https://aifw.io/docs/guides/chain-of-command). This
package is one of **two** independent implementations of them: the .NET client lives in
`PkiRemoteAgent.A2A.CoC.Client`. Both are tested against the same **platform-issued** voucher in
[`sdk/testdata/voucher-vector.json`](https://github.com/securetron-gh/aifw/blob/main/sdk/testdata/voucher-vector.json), which is what makes the format
credible rather than merely self-consistent.

## Install

```bash
pip install -e sdk/python          # from the repository root
# or, with no install at all:
PYTHONPATH=sdk/python python your_agent.py
```

Only one dependency: [`cryptography`](https://pypi.org/project/cryptography/) (for ES256). The HTTP client
is standard library, so there is no `requests` dependency to vendor.

## Agent side  -  verify a voucher offline

```python
from aifw_coc import CoCClient, ReportSigner, VoucherVerifier

agent = CoCClient("https://agent-trust.example.com", api_key=AGENT_KEY)

# 1. Pin the anchor once. Check the fingerprint out of band on first install.
anchor = agent.get_trust_anchor()
print(anchor[0].public_key_pem, anchor[0].fingerprint_sha256)
verifier = VoucherVerifier(anchor)

# 2. Verify the voucher that arrived with the instruction  -  no call to the platform.
result = verifier.verify(voucher_token, expected_sub_agent_id="fleet-sub-1", payload=raw_payload)
if not result.ok:
    raise RuntimeError(f"refused: {result.rejection.name}  -  {result.error}")

claims = result.claims
print(claims.order_leg_id, claims.skill_id, claims.policy_version)
```

`verify` refuses with a **specific** reason  -  `MALFORMED`, `UNSUPPORTED_ALGORITHM`, `UNKNOWN_KEY`,
`BAD_SIGNATURE`, `EXPIRED`, `WRONG_SUB_AGENT`, `PAYLOAD_MISMATCH`, `STALE_POLICY`  -  so a caller can log and
act on the real one. Pass `current_policy_version` (from `agent.get_status()["policyVersion"]`) to have
stale allowlists detected, and `now=` to make expiry testable.

Then honour the posture the envelope carried:

```python
mode = envelope["verifyMode"]              # offline | callback-optional | callback-required
if mode == "callback-required" and not agent.get_authorization(claims.order_leg_id).valid:
    raise RuntimeError("the platform did not confirm this authorisation")
```

## Agent side  -  report a signed result

```python
signer = ReportSigner(AGENT_PRIVATE_KEY_PEM)          # the key whose public half you registered
agent.report_result(
    claims.order_leg_id, "succeeded", "rotated 12 nodes",
    signer.sign(claims.order_leg_id, claims.nonce, "succeeded", "rotated 12 nodes"),
)
```

The signed message binds the leg id **and** the voucher nonce, so a report cannot be lifted from another
leg. The platform verifies before believing: an unsigned or unverifiable report settles the leg as
`UNVERIFIED`, which is explicitly **not** success.

Generating a key pair for a new agent:

```python
from aifw_coc import new_key_pair
private_pem, public_pem = new_key_pair()   # register public_pem as the agent's publicKeyPem
```

## Operator side  -  hub, sub-agents, swarm, orders

```python
owner = CoCClient("https://agent-trust.example.com", api_key=OWNER_KEY)

# The hub and each sub-agent are ordinary agents: register, publish, claim. Then:
swarm = owner.create_swarm("fleet-hub-1", "Fleet",
                           sub_agent_ids=["fleet-sub-1", "fleet-sub-2"],
                           skills=["RenewCertificate", "FleetRotateNote"])
swarm_id = swarm["swarmId"]

# Mixed ownership: the member's own owner records consent.
sub_owner = CoCClient(base, api_key=OTHER_OWNER_KEY)
sub_owner.record_consent("fleet-hub-1", swarm_id, "fleet-sub-2", expires_at="2027-01-01T00:00:00Z")

# Governance, cascade, and the voucher posture.
owner.grant_capability("fleet-hub-1", swarm_id, "view_subagent_status")
owner.set_cascade("fleet-hub-1", swarm_id, on_suspend=True, on_revoke=True)
owner.set_voucher_verify("fleet-hub-1", swarm_id,
                         mode="callback-optional", by_skill={"FleetRotateNote": "callback-required"})

# The hub sends an order with its own credential.
hub = CoCClient(base, api_key=HUB_KEY)
order = hub.send_order(swarm_id, "FleetRotateNote", '{"target":"node-1","reason":"scheduled"}',
                       idempotency_key="6f1c…")
print(order.relayed, [leg.state for leg in order.legs])   # RELAYED is deferred, not success

hub.revoke_order(order.swarm_order_id)
```

Failed calls raise `CoCError` carrying the platform's JSON-RPC code:

```python
from aifw_coc import CoCError
try:
    owner.create_swarm("fleet-hub-1", "Fleet")
except CoCError as error:
    print(error.status, error.code, error.message)   # e.g. 403 None "…", or 400 -32602 "…"
```

## Tests

```bash
PYTHONPATH=sdk/python python -m unittest discover -s sdk/python/tests -t sdk/python -v
```

15 tests, all against the platform-issued vector: signature verification, tamper/expiry/wrong-agent/
wrong-payload/stale-policy/unknown-key/malformed refusals, the fingerprint format, anchor parsing, and the
report signature.
