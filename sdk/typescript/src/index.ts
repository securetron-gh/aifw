/**
 * AI-FW **Chain of Command** SDK (TypeScript / Node).
 *
 * Create hub agents and sub-agents, manage a swarm, send orders  -  and, on the agent side, verify command
 * vouchers **offline** and report signed results.
 *
 * ```ts
 * import { CoCClient, VoucherVerifier, ReportSigner, newIdempotencyKey } from 'aifw-coc';
 *
 * // Operator: create a swarm and send an order.
 * const owner = new CoCClient(baseUrl, { apiKey: ownerKey });
 * const swarm = await owner.createSwarm('fleet-hub-1', 'Fleet', ['fleet-sub-1'], ['FleetRotateNote']);
 * const hub = new CoCClient(baseUrl, { apiKey: hubKey });
 * const order = await hub.sendOrder(swarm.swarmId, 'FleetRotateNote', '{"target":"node-1"}',
 *                                   { idempotencyKey: newIdempotencyKey() });
 *
 * // Sub-agent: verify the voucher offline, then report the outcome.
 * const verifier = await VoucherVerifier.create(await agent.getTrustAnchor());
 * const result = await verifier.verify(voucher, { expectedSubAgentId: 'fleet-sub-1', payload });
 * if (result.ok) {
 *   const signer = await ReportSigner.create(agentPrivateKeyPem);
 *   await agent.reportResult(result.claims.orderLegId, 'succeeded', 'rotated',
 *     await signer.sign(result.claims.orderLegId, result.claims.nonce, 'succeeded', 'rotated'));
 * }
 * ```
 *
 * The wire contracts are documented in `docs/chain-of-command.md`.
 */

export {
  CoCClient,
  CoCError,
  type CoCAuthorization,
  type CoCClientOptions,
  type CoCLeg,
  type CoCOrderResult,
} from './client.ts';

export {
  Rejection,
  VoucherVerifier,
  base64UrlDecode,
  base64UrlEncode,
  derToRaw,
  fingerprint,
  hashPayload,
  rawToDer,
  type TrustAnchorKey,
  type VerifyOptions,
  type VoucherClaims,
  type VoucherVerification,
} from './voucher.ts';

export {
  ReportSigner,
  canonicalReport,
  newIdempotencyKey,
  newKeyPair,
  newNonce,
  verifyReport,
} from './report.ts';

export const VERSION = '1.0.0';
