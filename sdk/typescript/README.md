# AI-FW Chain of Command  -  TypeScript SDK

Create hub agents and sub-agents, manage a swarm, send orders  -  and, on the agent side, verify command
vouchers **offline** and report signed results.

The wire contracts are specified in [`docs/chain-of-command.md`](https://aifw.io/docs/guides/chain-of-command). This
package is one of **three** independent implementations of them (see also `PkiRemoteAgent.A2A.CoC.Client`
for .NET and `sdk/python` for Python). All three are tested against the same **platform-issued** voucher in
[`sdk/testdata/voucher-vector.json`](https://github.com/securetron-gh/aifw/blob/main/sdk/testdata/voucher-vector.json)  -  which is what makes the format
credible rather than merely self-consistent.

## Requirements

Node **20+**. Zero runtime dependencies: the HTTP client uses global `fetch`, and the cryptographic work
uses WebCrypto (`globalThis.crypto`). TypeScript is a dev dependency only, for type-checking and the build.

```bash
npm install        # dev deps only (typescript, @types/node)
npm test           # node:test, no build step required
npm run typecheck  # tsc --noEmit
npm run build      # emits dist/ (JS + .d.ts)
```

## Agent side  -  verify a voucher offline

```ts
import { CoCClient, VoucherVerifier, ReportSigner, newIdempotencyKey } from 'aifw-coc';

const agent = new CoCClient('https://agent-trust.example.com', { apiKey: agentKey });

// Pin the anchor once. Check the fingerprint out of band on first install.
const anchor = await agent.getTrustAnchor();
console.log(anchor[0].publicKeyPem, anchor[0].fingerprintSha256);
const verifier = await VoucherVerifier.create(anchor);

// Verify the voucher that arrived with the instruction  -  no call to the platform.
const result = await verifier.verify(voucherToken, {
  expectedSubAgentId: 'fleet-sub-1',
  payload: rawPayload,
});
if (!result.ok) throw new Error(`refused: ${result.rejection}  -  ${result.error}`);

console.log(result.claims!.orderLegId, result.claims!.skillId, result.claims!.policyVersion);
```

`verify` refuses with a **specific** reason  -  `Malformed`, `UnsupportedAlgorithm`, `UnknownKey`,
`BadSignature`, `Expired`, `WrongSubAgent`, `PayloadMismatch`, `StalePolicy`  -  so a caller can log and act on
the real one. Pass `currentPolicyVersion` (from `agent.getStatus()`) to have stale allowlists detected, and
`now` to make expiry testable.

Then honour the posture the envelope carried:

```ts
const mode = envelope.verifyMode;                    // offline | callback-optional | callback-required
if (mode === 'callback-required' && !(await agent.getAuthorization(claims.orderLegId)).valid) {
  throw new Error('the platform did not confirm this authorisation');
}
```

## Agent side  -  report a signed result

```ts
const signer = await ReportSigner.create(agentPrivateKeyPem);   // the key whose public half you registered
await agent.reportResult(
  claims.orderLegId,
  'succeeded',
  'rotated 12 nodes',
  await signer.sign(claims.orderLegId, claims.nonce, 'succeeded', 'rotated 12 nodes'),
);
```

The signed message binds the leg id **and** the voucher nonce, so a report cannot be lifted from another
leg. The platform verifies before believing: an unsigned or unverifiable report settles the leg as
`UNVERIFIED`, which is explicitly **not** success.

`ReportSigner.create` imports the key **extractable**, which is what lets WebCrypto derive the public half
for `publicKeyPem`. If you would rather the private key never be exportable (an HSM-backed `CryptoKey`),
import it yourself and use `ReportSigner.fromKey(privateKey, publicKeyPem)`.

Generating a key pair for a new agent:

```ts
import { newKeyPair } from 'aifw-coc';
const { privateKeyPem, publicKeyPem } = await newKeyPair();   // register publicKeyPem on the agent
```

## Operator side  -  hub, sub-agents, swarm, orders

```ts
const owner = new CoCClient(baseUrl, { apiKey: ownerKey });

// The hub and each sub-agent are ordinary agents: register, publish, claim. Then:
const swarm = await owner.createSwarm('fleet-hub-1', 'Fleet',
  ['fleet-sub-1', 'fleet-sub-2'], ['RenewCertificate', 'FleetRotateNote']);

// Mixed ownership: the member's own owner records consent.
const subOwner = new CoCClient(baseUrl, { apiKey: otherOwnerKey });
await subOwner.recordConsent('fleet-hub-1', swarm.swarmId, 'fleet-sub-2', '2027-01-01T00:00:00Z');

// Governance, cascade, and the voucher posture.
await owner.grantCapability('fleet-hub-1', swarm.swarmId, 'view_subagent_status');
await owner.setCascade('fleet-hub-1', swarm.swarmId, true, true);
await owner.setVoucherVerify('fleet-hub-1', swarm.swarmId, 'callback-optional',
  { FleetRotateNote: 'callback-required' });

// The hub sends an order with its own credential.
const hub = new CoCClient(baseUrl, { apiKey: hubKey });
const order = await hub.sendOrder(swarm.swarmId, 'FleetRotateNote', '{"target":"node-1","reason":"scheduled"}',
  { idempotencyKey: newIdempotencyKey() });
console.log(order.relayed, order.legs.map((leg) => leg.state));   // RELAYED is deferred, not success

await hub.revokeOrder(order.swarmOrderId);
```

Failed calls throw `CoCError` carrying the platform's JSON-RPC code:

```ts
try {
  await owner.createSwarm('fleet-hub-1', 'Fleet');
} catch (error) {
  if (error instanceof CoCError) console.log(error.status, error.code, error.message);
}
```

## Tests

```bash
npm test
```

15 tests, all against the platform-issued vector: signature verification, tamper/expiry/wrong-agent/
wrong-payload/stale-policy/unknown-key/malformed refusals, the fingerprint format, anchor parsing, and the
report signature.
