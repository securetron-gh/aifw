/**
 * Signing a sub-agent's result report (SW-1.13).
 *
 * The agent signs with its **own** key  -  the one whose public half is registered as the agent's
 * `PublicKeyPem`  -  over a message that binds the leg id **and** the voucher's nonce, so a report cannot be
 * lifted from one leg to another:
 *
 *     orderLegId + "\n" + nonce + "\n" + state + "\n" + detail
 */

import { randomBytes, randomUUID } from 'node:crypto';
import type { webcrypto } from 'node:crypto';
import { derToRaw, pemToDer, toPem } from './voucher.ts';

/** The exact message both sides sign. */
export function canonicalReport(
  orderLegId: string,
  nonce: string,
  state: string,
  detail?: string | null,
): string {
  return [orderLegId ?? '', nonce ?? '', state ?? '', detail ?? ''].join('\n');
}

/** A fresh P-256 key pair for an agent. Register the **public** key as the agent's `publicKeyPem`. */
export async function newKeyPair(): Promise<{ privateKeyPem: string; publicKeyPem: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  return { privateKeyPem: toPem(pkcs8, 'PRIVATE KEY'), publicKeyPem: toPem(spki, 'PUBLIC KEY') };
}

/** A nonce for a leg. The platform generates the nonce for its own vouchers; this is for callers that
 * manage their own leg identity. */
export function newNonce(): string {
  return randomBytes(16).toString('hex');
}

/** A correlation id for an order retry  -  the value to send as `X-Idempotency-Key`. */
export function newIdempotencyKey(): string {
  return randomUUID();
}

/** Signs result reports with the agent's own key. */
export class ReportSigner {
  private readonly key: webcrypto.CryptoKey;
  readonly publicKeyPem: string;

  private constructor(key: webcrypto.CryptoKey, publicKeyPem: string) {
    this.key = key;
    this.publicKeyPem = publicKeyPem;
  }

  /**
   * Create a signer from the agent's private key (PKCS#8 PEM).
   *
   * The key is imported **extractable**, which is what lets WebCrypto derive the matching public key for
   * `publicKeyPem`. That is a real trade-off: WebCrypto cannot compute a public key from a private one
   * without exporting it. If you would rather the private key never be exportable, construct the signer
   * with `ReportSigner.fromKey(privateKey, publicKeyPem)` instead.
   */
  static async create(privateKeyPem: string): Promise<ReportSigner> {
    const key = await crypto.subtle.importKey(
      'pkcs8',
      pemToDer(privateKeyPem) as unknown as ArrayBuffer,
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign'],
    );
    const jwk = await crypto.subtle.exportKey('jwk', key);
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['verify'],
    );
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', publicKey));
    return new ReportSigner(key, toPem(spki, 'PUBLIC KEY'));
  }

  /**
   * Build a signer from an already-imported private key plus the public PEM to advertise  -  for callers that
   * keep the private key non-extractable (an HSM-backed `webcrypto.CryptoKey`, for instance).
   */
  static fromKey(privateKey: webcrypto.CryptoKey, publicKeyPem: string): ReportSigner {
    return new ReportSigner(privateKey, publicKeyPem);
  }

  /** Sign a report. The result is base64 raw `r‖s`, which is what the platform accepts. */
  async sign(orderLegId: string, nonce: string, state: string, detail?: string | null): Promise<string> {
    const message = new TextEncoder().encode(canonicalReport(orderLegId, nonce, state, detail));
    const signature = new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.key, message),
    );
    return Buffer.from(signature).toString('base64');
  }
}

/** Verify a report the way the platform does (useful for an agent's own tests). */
export async function verifyReport(
  publicKeyPem: string,
  orderLegId: string,
  nonce: string,
  state: string,
  detail: string | null,
  signatureBase64: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'spki',
      pemToDer(publicKeyPem) as unknown as ArrayBuffer,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const signature = new Uint8Array(Buffer.from(signatureBase64, 'base64'));
    const message = new TextEncoder().encode(canonicalReport(orderLegId, nonce, state, detail));
    // Accept the raw form the platform uses, and DER from other tooling.
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      derToRaw(signature) as unknown as ArrayBuffer,
      message as unknown as ArrayBuffer,
    );
  } catch {
    return false;
  }
}
