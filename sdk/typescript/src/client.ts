/**
 * A client for the Chain-of-Command and swarm surface.
 *
 * Covers both sides: an **operator** creating and managing swarms, and an **agent** reading its own view,
 * verifying vouchers, confirming authorisations and reporting results. Uses the global `fetch`  -  no
 * dependency to install.
 */

import type { TrustAnchorKey } from './voucher.ts';

/** A failed CoC call, with the platform's own JSON-RPC error code and message. */
export class CoCError extends Error {
  readonly status: number;
  readonly code: number | undefined;

  constructor(status: number, code: number | undefined, message: string) {
    super(message);
    this.name = 'CoCError';
    this.status = status;
    this.code = code;
  }
}

export interface CoCLeg {
  subAgentId: string;
  orderLegId: string;
  taskId: string;
  state: string;
  error?: string | null;
}

export interface CoCOrderResult {
  swarmOrderId: string;
  total: number;
  succeeded: number;
  failed: number;
  rejected: number;
  /** Relayed legs are **deferred**, not successful: the sub-agent reports the outcome later. */
  relayed: number;
  stoppedEarly: boolean;
  replayed: boolean;
  legs: CoCLeg[];
}

/** Whether a leg's authorisation still stands (the live callback). */
export interface CoCAuthorization {
  orderLegId: string;
  valid: boolean;
  revoked: boolean;
  status: string;
  skillId: string;
  hubId: string;
  policyVersion: number;
  expiresAt: string;
}

export interface CoCClientOptions {
  /**
   * The credential to act with. An **agent API key** authenticates as the agent it belongs to  -  never as
   * the key's label  -  which is what the agent-facing endpoints require.
   */
  apiKey?: string;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
  /** Supply your own `fetch` (Node < 18, a proxy, tests). */
  fetchImpl?: typeof fetch;
}

export class CoCClient {
  private readonly base: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly doFetch: typeof fetch;

  constructor(baseUrl: string, options: CoCClientOptions = {}) {
    this.base = baseUrl.replace(/\/+$/, '') + '/';
    this.headers = options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {};
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.doFetch = options.fetchImpl ?? fetch;
  }

  // ── agent side ──────────────────────────────────────────────────────────────────────────

  /** The caller's own versioned view: owner, hub, swarm, granted skills, policy generation. */
  getStatus(): Promise<Record<string, any>> {
    return this.request('GET', 'agent/status');
  }

  /** Fetch the voucher trust anchor. Verify a fingerprint out of band before pinning it. */
  async getTrustAnchor(): Promise<TrustAnchorKey[]> {
    const body = await this.request('GET', 'agent/trust-anchor');
    return (body.keys ?? []) as TrustAnchorKey[];
  }

  /** The live confirmation a `callback-required` swarm needs before executing. */
  async getAuthorization(orderLegId: string): Promise<CoCAuthorization> {
    const body = await this.request('GET', `a2a/v1/authorizations/${encodeURIComponent(orderLegId)}`);
    return {
      orderLegId: body.orderLegId ?? orderLegId,
      valid: body.valid ?? false,
      revoked: body.revoked ?? false,
      status: body.status ?? '',
      skillId: body.skillId ?? '',
      hubId: body.hubId ?? '',
      policyVersion: body.policyVersion ?? 0,
      expiresAt: body.expiresAt ?? '',
    };
  }

  /**
   * Report a leg's outcome. Sign it with `ReportSigner`  -  an unsigned report is recorded as `UNVERIFIED`
   * rather than as success.
   */
  reportResult(
    orderLegId: string,
    state: 'succeeded' | 'failed',
    detail?: string | null,
    signature?: string | null,
  ): Promise<Record<string, any>> {
    return this.request('POST', `a2a/v1/swarm/legs/${encodeURIComponent(orderLegId)}:report`, {
      state,
      detail,
      signature,
    });
  }

  // ── operator side ───────────────────────────────────────────────────────────────────────

  /** Create a swarm for a hub. Re-creating the same hub + name is idempotent. */
  createSwarm(
    hubAgentId: string,
    name: string,
    subAgentIds: string[] = [],
    skills: string[] = [],
  ): Promise<Record<string, any>> {
    return this.request('POST', `agent/${encodeURIComponent(hubAgentId)}/swarm`, {
      name,
      subAgentIds,
      skills,
    });
  }

  listSwarms(hubAgentId: string): Promise<Record<string, any>> {
    return this.request('GET', `agent/${encodeURIComponent(hubAgentId)}/swarm`);
  }

  /** Members, narrowed to what the caller is entitled to see. */
  listMembers(hubAgentId: string, swarmId: string): Promise<Record<string, any>> {
    return this.request('GET', `agent/${encodeURIComponent(hubAgentId)}/swarm/${swarmId}/members`);
  }

  addMember(hubAgentId: string, swarmId: string, subAgentId: string): Promise<Record<string, any>> {
    return this.request('POST', `agent/${encodeURIComponent(hubAgentId)}/swarm/${swarmId}/members`, {
      subAgentId,
    });
  }

  /** Record consent for a mixed-ownership member. Omit `expiresAt` to use the platform's
   * `swarm_consent_valid_days` (0 = never). */
  recordConsent(
    hubAgentId: string,
    swarmId: string,
    subAgentId: string,
    expiresAt?: string,
  ): Promise<Record<string, any>> {
    return this.request(
      'POST',
      `agent/${encodeURIComponent(hubAgentId)}/swarm/${swarmId}/members/${encodeURIComponent(subAgentId)}/consent`,
      { expiresAt },
    );
  }

  removeMember(hubAgentId: string, swarmId: string, subAgentId: string): Promise<Record<string, any>> {
    return this.request(
      'DELETE',
      `agent/${encodeURIComponent(hubAgentId)}/swarm/${swarmId}/members/${encodeURIComponent(subAgentId)}`,
    );
  }

  disbandSwarm(hubAgentId: string, swarmId: string): Promise<Record<string, any>> {
    return this.request('POST', `agent/${encodeURIComponent(hubAgentId)}/swarm/${swarmId}/disband`);
  }

  grantCapability(hubAgentId: string, swarmId: string, capability: string): Promise<Record<string, any>> {
    return this.request('POST', `agent/${encodeURIComponent(hubAgentId)}/swarm/${swarmId}/capabilities`, {
      capability,
    });
  }

  revokeCapability(hubAgentId: string, swarmId: string, capability: string): Promise<Record<string, any>> {
    return this.request(
      'DELETE',
      `agent/${encodeURIComponent(hubAgentId)}/swarm/${swarmId}/capabilities/${encodeURIComponent(capability)}`,
    );
  }

  /** Per-swarm cascade policy. Both default to off. */
  setCascade(
    hubAgentId: string,
    swarmId: string,
    onSuspend: boolean,
    onRevoke: boolean,
  ): Promise<Record<string, any>> {
    return this.request('PUT', `agent/${encodeURIComponent(hubAgentId)}/swarm/${swarmId}/cascade`, {
      onSuspend,
      onRevoke,
    });
  }

  /**
   * SW-1.10a: `offline` | `callback-optional` | `callback-required`, with per-skill overrides.
   *
   * Owner/admin only  -  the hub cannot set its own posture. An unrecognised mode is refused.
   */
  setVoucherVerify(
    hubAgentId: string,
    swarmId: string,
    mode?: string,
    bySkill?: Record<string, string>,
  ): Promise<Record<string, any>> {
    return this.request('PUT', `agent/${encodeURIComponent(hubAgentId)}/swarm/${swarmId}/voucher-verify`, {
      mode,
      bySkill,
    });
  }

  /** Send an order from the hub to every consenting member. */
  async sendOrder(
    swarmId: string,
    skill: string,
    instruction: string,
    options: { failFast?: boolean; idempotencyKey?: string } = {},
  ): Promise<CoCOrderResult> {
    const body = await this.request(
      'POST',
      `a2a/v1/swarm/${swarmId}:send`,
      { skill, instruction, failFast: options.failFast ?? false },
      options.idempotencyKey ? { 'X-Idempotency-Key': options.idempotencyKey } : undefined,
    );

    const legs: CoCLeg[] = (body.perSubAgent ?? []).map((leg: Record<string, any>) => ({
      subAgentId: leg.subAgentId ?? '',
      orderLegId: leg.orderLegId ?? '',
      taskId: leg.taskId ?? '',
      state: leg.state ?? '',
      error: leg.error ?? null,
    }));

    return {
      swarmOrderId: body.swarmOrderId,
      total: body.total ?? 0,
      succeeded: body.succeeded ?? 0,
      failed: body.failed ?? 0,
      rejected: body.rejected ?? 0,
      relayed: body.relayed ?? 0,
      stoppedEarly: body.stoppedEarly ?? false,
      replayed: body.replayed ?? false,
      legs,
    };
  }

  /** Revoke what is left of an order. Legs that already ran are left alone. */
  revokeOrder(orderId: string): Promise<Record<string, any>> {
    return this.request('POST', `a2a/v1/swarm/${orderId}:revoke`);
  }

  /** Claim an agent for the caller (or hand a sponsor code in). */
  claim(
    agentId: string,
    options: { ownerId?: string; ownerGroup?: string; sponsorCode?: string } = {},
  ): Promise<Record<string, any>> {
    return this.request('POST', 'agent/claim', {
      agentId,
      ownerId: options.ownerId,
      ownerGroup: options.ownerGroup,
      sponsorCode: options.sponsorCode,
    });
  }

  /** Grant a delegation, optionally clamped below `max_delegation_depth` and time-bounded. */
  grantDelegation(
    agentId: string,
    delegateId: string,
    skills: string[],
    maxDepth?: number,
    expiresAt?: string,
  ): Promise<Record<string, any>> {
    return this.request('POST', `agent/${encodeURIComponent(agentId)}/delegations`, {
      delegateId,
      skills,
      maxDepth,
      expiresAt,
    });
  }

  // ── plumbing ────────────────────────────────────────────────────────────────────────────

  private async request(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<Record<string, any>> {
    const headers: Record<string, string> = { Accept: 'application/json', ...this.headers, ...extraHeaders };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.doFetch(this.base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new CoCError(0, undefined, `Could not reach ${this.base}${path}: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    if (!response.ok) {
      const parsed = safeParse(text);
      throw new CoCError(response.status, parsed?.code, parsed?.message ?? `HTTP ${response.status}`);
    }
    return safeParse(text) ?? {};
  }
}

function safeParse(text: string): Record<string, any> | undefined {
  if (!text?.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
