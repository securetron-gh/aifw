/**
 * Voucher verification  -  implemented independently of the .NET and Python SDKs, from the wire format.
 *
 * A voucher is a JWS compact token (RFC 7515): `base64url(header) . base64url(payload) . base64url(sig)`,
 * signed ES256 (ECDSA P-256 / SHA-256) in the raw `r‖s` form JWS uses. The signer is named by the header's
 * `kid`, which the verifier must already hold  -  that is what makes verification work offline, with no call
 * back to the platform.
 *
 * WebCrypto is used throughout, and it is a happy accident that its ECDSA signatures are already the raw
 * `r‖s` form the voucher format specifies: no DER conversion on the verify path.
 */

import { createHash } from 'node:crypto';
import type { webcrypto } from 'node:crypto';

/** Why a voucher was refused. Specific, so a caller can log and act on the real reason. */
export const Rejection = {
  None: 'None',
  Malformed: 'Malformed',
  UnsupportedAlgorithm: 'UnsupportedAlgorithm',
  UnknownKey: 'UnknownKey',
  BadSignature: 'BadSignature',
  Expired: 'Expired',
  WrongSubAgent: 'WrongSubAgent',
  PayloadMismatch: 'PayloadMismatch',
  StalePolicy: 'StalePolicy',
} as const;

export type Rejection = (typeof Rejection)[keyof typeof Rejection];

/** One entry of `GET /agent/trust-anchor`. */
export interface TrustAnchorKey {
  kid: string;
  algorithm: string;
  publicKeyPem: string;
  fingerprintSha256?: string;
  signing?: boolean;
  retired?: boolean;
}

export interface VoucherClaims {
  orderLegId: string;
  hubId: string;
  subAgentId: string;
  skillId: string;
  payloadHash: string;
  policyVersion: number;
  issuer: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}

export interface VoucherVerification {
  ok: boolean;
  rejection: Rejection;
  error?: string;
  claims?: VoucherClaims;
}

export interface VerifyOptions {
  /** Your own agent id  -  the `subAgentId == self` check. */
  expectedSubAgentId?: string;
  /** The instruction you actually received, so the payload binding is checked rather than assumed. */
  payload?: string;
  /** What your `GET /agent/status` reports, when you want stale allowlists detected. */
  currentPolicyVersion?: number;
  /** Override "now" for expiry tests. */
  now?: Date;
}

export function base64UrlEncode(data: Uint8Array): string {
  return Buffer.from(data).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function base64UrlDecode(value: string): Uint8Array {
  const text = value.replace(/-/g, '+').replace(/_/g, '/');
  return new Uint8Array(Buffer.from(text, 'base64'));
}

/** SHA-256 (hex) of the exact payload bytes  -  the value a voucher binds to. */
export function hashPayload(payload?: string | null): string {
  return createHash('sha256').update(payload ?? '', 'utf8').digest('hex');
}

function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  return new Uint8Array(Buffer.from(body, 'base64'));
}

function toPem(der: Uint8Array, label: string): string {
  const body = Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n').trimEnd();
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

/**
 * Colon-separated SHA-256 of the key's DER  -  compare this with what the platform published **out of band**
 * before trusting the anchor.
 */
export function fingerprint(publicKeyPem: string): string {
  const digest = createHash('sha256').update(Buffer.from(pemToDer(publicKeyPem))).digest();
  return [...digest].map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(':');
}

/** DER `SEQUENCE { r, s }` → the raw 64-byte `r‖s` WebCrypto verifies. Also accepts raw input. */
export function derToRaw(der: Uint8Array): Uint8Array {
  if (der.length === 64) return der;
  if (der[0] !== 0x30) throw new Error('Unrecognised ECDSA signature encoding.');

  let offset = 2;
  if ((der[1] & 0x80) !== 0) offset += der[1] & 0x7f;

  const readInteger = (): Uint8Array => {
    if (der[offset++] !== 0x02) throw new Error('Invalid DER signature.');
    const length = der[offset++];
    let start = offset;
    let size = length;
    if (length === 33 && der[start] === 0) {
      start += 1;
      size = 32;
    }
    offset = start + (length === 33 ? length - 1 : length);
    const out = new Uint8Array(32);
    out.set(der.subarray(start, start + size), 32 - size);
    return out;
  };

  const r = readInteger();
  const s = readInteger();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

/** Raw `r‖s` → DER, for callers that need the long form. */
export function rawToDer(raw: Uint8Array): Uint8Array {
  if (raw.length !== 64) throw new Error('An ES256 signature must be 64 bytes (r‖s).');
  const integer = (value: Uint8Array): Uint8Array => {
    let start = 0;
    while (start < value.length - 1 && value[start] === 0) start += 1;
    const needsPad = (value[start] & 0x80) !== 0;
    const body = new Uint8Array(value.length - start + (needsPad ? 1 : 0));
    body.set(value.subarray(start), needsPad ? 1 : 0);
    return new Uint8Array([0x02, body.length, ...body]);
  };
  const r = integer(raw.subarray(0, 32));
  const s = integer(raw.subarray(32, 64));
  return new Uint8Array([0x30, r.length + s.length, ...r, ...s]);
}

/** Verifies command vouchers offline against a pinned trust anchor. */
export class VoucherVerifier {
  private readonly keys: Map<string, webcrypto.CryptoKey>;

  private constructor(keys: Map<string, webcrypto.CryptoKey>) {
    this.keys = keys;
  }

  /**
   * Build a verifier from the anchor you pinned. Entries with an unusable key are skipped rather than
   * failing the whole anchor, so one bad row cannot lock an agent out.
   */
  static async create(anchorKeys: Iterable<TrustAnchorKey>): Promise<VoucherVerifier> {
    const keys = new Map<string, webcrypto.CryptoKey>();
    for (const entry of anchorKeys) {
      if (!entry.kid || !entry.publicKeyPem) continue;
      try {
        const key = await crypto.subtle.importKey(
          'spki',
          pemToDer(entry.publicKeyPem) as unknown as ArrayBuffer,
          { name: 'ECDSA', namedCurve: 'P-256' },
          false,
          ['verify'],
        );
        keys.set(entry.kid, key);
      } catch {
        // Not a usable key  -  skip it.
      }
    }
    return new VoucherVerifier(keys);
  }

  /** Build a verifier straight from the `GET /agent/trust-anchor` response body. */
  static async fromTrustAnchorJson(trustAnchorJson: string): Promise<VoucherVerifier> {
    const document = JSON.parse(trustAnchorJson) as { keys?: TrustAnchorKey[] };
    return VoucherVerifier.create(document.keys ?? []);
  }

  /** The key ids this verifier holds  -  useful for a "do I need to re-fetch the anchor?" check. */
  get kids(): string[] {
    return [...this.keys.keys()].sort();
  }

  async verify(token: string | null | undefined, options: VerifyOptions = {}): Promise<VoucherVerification> {
    if (!token) {
      return { ok: false, rejection: Rejection.Malformed, error: 'A voucher is required.' };
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      return { ok: false, rejection: Rejection.Malformed, error: 'Not a well-formed voucher token.' };
    }

    let header: { alg?: string; kid?: string };
    try {
      header = JSON.parse(Buffer.from(base64UrlDecode(parts[0])).toString('utf8'));
    } catch {
      return { ok: false, rejection: Rejection.Malformed, error: 'The voucher header is unreadable.' };
    }

    if (header.alg !== 'ES256') {
      return {
        ok: false,
        rejection: Rejection.UnsupportedAlgorithm,
        error: `Unsupported algorithm '${header.alg ?? ''}'.`,
      };
    }

    const key = this.keys.get(header.kid ?? '');
    if (!key) {
      return {
        ok: false,
        rejection: Rejection.UnknownKey,
        error: `Key '${header.kid ?? ''}' is not in the trust anchor.`,
      };
    }

    let signature: Uint8Array;
    let rawClaims: Record<string, unknown>;
    try {
      signature = base64UrlDecode(parts[2]);
      rawClaims = JSON.parse(Buffer.from(base64UrlDecode(parts[1])).toString('utf8'));
    } catch {
      return { ok: false, rejection: Rejection.Malformed, error: 'The voucher is unreadable.' };
    }

    const claims: VoucherClaims = {
      orderLegId: String(rawClaims.orderLegId ?? ''),
      hubId: String(rawClaims.hubId ?? ''),
      subAgentId: String(rawClaims.subAgentId ?? ''),
      skillId: String(rawClaims.skillId ?? ''),
      payloadHash: String(rawClaims.payloadHash ?? ''),
      policyVersion: Number(rawClaims.policyVersion ?? 0),
      issuer: String(rawClaims.issuer ?? ''),
      nonce: String(rawClaims.nonce ?? ''),
      issuedAt: new Date(String(rawClaims.issuedAt ?? 0)),
      expiresAt: new Date(String(rawClaims.expiresAt ?? 0)),
    };

    // The signature covers the base64url TEXT of header.payload, not the decoded bytes.
    const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    let good: boolean;
    try {
      good = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        derToRaw(signature) as unknown as ArrayBuffer,
        signingInput as unknown as ArrayBuffer,
      );
    } catch {
      good = false;
    }
    if (!good) {
      return {
        ok: false,
        rejection: Rejection.BadSignature,
        error: 'The voucher signature does not verify.',
        claims,
      };
    }

    const at = options.now ?? new Date();
    if (claims.expiresAt.getTime() <= at.getTime()) {
      return { ok: false, rejection: Rejection.Expired, error: 'The voucher has expired.', claims };
    }

    if (
      options.expectedSubAgentId &&
      claims.subAgentId.toLowerCase() !== options.expectedSubAgentId.toLowerCase()
    ) {
      return {
        ok: false,
        rejection: Rejection.WrongSubAgent,
        error: `The voucher is addressed to '${claims.subAgentId}', not to this agent.`,
        claims,
      };
    }

    if (options.payload !== undefined && claims.payloadHash !== hashPayload(options.payload)) {
      return {
        ok: false,
        rejection: Rejection.PayloadMismatch,
        error: 'The voucher does not match the instruction it accompanies.',
        claims,
      };
    }

    if (options.currentPolicyVersion !== undefined && claims.policyVersion !== options.currentPolicyVersion) {
      return {
        ok: false,
        rejection: Rejection.StalePolicy,
        error: `Issued against policy version ${claims.policyVersion}; current is ${options.currentPolicyVersion}.`,
        claims,
      };
    }

    return { ok: true, rejection: Rejection.None, claims };
  }
}

export { pemToDer, toPem };
