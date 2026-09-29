/**
 * Verifies the TypeScript verifier against a **platform-issued** voucher.
 *
 * Runs the same shared vector as the .NET and Python SDK tests
 * (`sdk/testdata/voucher-vector.json`), so a pass here means all three independent implementations agree
 * with the platform  -  not merely with themselves.
 *
 *     node --test --experimental-strip-types "tests/**\/*.test.ts"
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  Rejection,
  ReportSigner,
  VoucherVerifier,
  canonicalReport,
  fingerprint,
  hashPayload,
  newKeyPair,
  newNonce,
  verifyReport,
} from '../src/index.ts';

interface Vector {
  kid: string;
  publicKeyPem: string;
  token: string;
  tamperedToken: string;
  expiredToken: string;
  payload: string;
  claims: {
    orderLegId: string;
    hubId: string;
    subAgentId: string;
    skillId: string;
    payloadHash: string;
    policyVersion: number;
    nonce: string;
  };
  report: { state: string; detail: string; message: string; signature: string };
}

function findRoot(): string {
  let here = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 10; depth += 1) {
    try {
      readFileSync(join(here, 'AGENTS.md'));
      return here;
    } catch {
      here = resolve(here, '..');
    }
  }
  throw new Error('repo root not found (no AGENTS.md above this file)');
}

const VECTOR: Vector = JSON.parse(
  readFileSync(join(findRoot(), 'sdk', 'testdata', 'voucher-vector.json'), 'utf8'),
);

async function verifier(): Promise<VoucherVerifier> {
  return VoucherVerifier.create([
    { kid: VECTOR.kid, algorithm: 'ES256', publicKeyPem: VECTOR.publicKeyPem },
  ]);
}

test('a platform-issued voucher verifies offline', async () => {
  const result = await (await verifier()).verify(VECTOR.token, {
    expectedSubAgentId: VECTOR.claims.subAgentId,
    payload: VECTOR.payload,
  });

  assert.equal(result.ok, true, result.error);
  assert.equal(result.claims?.orderLegId, VECTOR.claims.orderLegId);
  assert.equal(result.claims?.hubId, VECTOR.claims.hubId);
  assert.equal(result.claims?.skillId, VECTOR.claims.skillId);
  assert.equal(result.claims?.nonce, VECTOR.claims.nonce);
  assert.equal(result.claims?.policyVersion, VECTOR.claims.policyVersion);
  // The digest is computed by this SDK and must equal the one the platform signed.
  assert.equal(VECTOR.claims.payloadHash, hashPayload(VECTOR.payload));
});

test('a tampered voucher is refused', async () => {
  const result = await (await verifier()).verify(VECTOR.tamperedToken);
  assert.equal(result.rejection, Rejection.BadSignature);
});

test('an expired voucher is refused', async () => {
  const result = await (await verifier()).verify(VECTOR.expiredToken);
  assert.equal(result.rejection, Rejection.Expired);
});

test('a voucher for another agent is refused', async () => {
  const result = await (await verifier()).verify(VECTOR.token, { expectedSubAgentId: 'someone-else' });
  assert.equal(result.rejection, Rejection.WrongSubAgent);
});

test('a voucher for another payload is refused', async () => {
  const result = await (await verifier()).verify(VECTOR.token, { payload: '{"target":"node-2"}' });
  assert.equal(result.rejection, Rejection.PayloadMismatch);
});

test('a stale policy version is refused', async () => {
  const instance = await verifier();
  const issued = VECTOR.claims.policyVersion;

  assert.equal((await instance.verify(VECTOR.token, { currentPolicyVersion: issued + 1 })).rejection, Rejection.StalePolicy);
  assert.equal((await instance.verify(VECTOR.token, { currentPolicyVersion: issued })).ok, true);
});

test('an unknown key is refused', async () => {
  const stranger = await VoucherVerifier.create([
    { kid: 'some-other-key', algorithm: 'ES256', publicKeyPem: VECTOR.publicKeyPem },
  ]);

  assert.equal((await stranger.verify(VECTOR.token)).rejection, Rejection.UnknownKey);
});

test('malformed input is refused', async () => {
  const instance = await verifier();

  assert.equal((await instance.verify(null)).rejection, Rejection.Malformed);
  assert.equal((await instance.verify('not-a-token')).rejection, Rejection.Malformed);
  assert.equal((await instance.verify('a.b')).rejection, Rejection.Malformed);
  assert.equal((await instance.verify('!!!.???.***')).rejection, Rejection.Malformed);
});

test('an unsupported algorithm is refused before any signature work', async () => {
  const header = Buffer.from('{"alg":"none","kid":"x"}').toString('base64url');
  const payload = Buffer.from('{}').toString('base64url');

  const result = await (await verifier()).verify(`${header}.${payload}.AAAA`);
  assert.equal(result.rejection, Rejection.UnsupportedAlgorithm);
});

test('the fingerprint is a colon-separated sha256', async () => {
  const pairs = fingerprint(VECTOR.publicKeyPem).split(':');

  assert.equal(pairs.length, 32);
  assert.ok(pairs.every((pair) => pair.length === 2));
});

test('fromTrustAnchorJson builds a working verifier', async () => {
  const anchor = JSON.stringify({
    keys: [
      {
        kid: VECTOR.kid,
        algorithm: 'ES256',
        publicKeyPem: VECTOR.publicKeyPem,
        fingerprintSha256: '',
        signing: true,
        retired: false,
      },
    ],
  });

  const instance = await VoucherVerifier.fromTrustAnchorJson(anchor);

  assert.deepEqual(instance.kids, [VECTOR.kid]);
  assert.equal((await instance.verify(VECTOR.token)).ok, true);
});

test('the vector report signature verifies', async () => {
  const ok = await verifyReport(
    VECTOR.publicKeyPem,
    VECTOR.claims.orderLegId,
    VECTOR.claims.nonce,
    VECTOR.report.state,
    VECTOR.report.detail,
    VECTOR.report.signature,
  );

  assert.equal(ok, true);
});

test('a fresh report round-trips, and the binding holds', async () => {
  const { privateKeyPem, publicKeyPem } = await newKeyPair();
  const signer = await ReportSigner.create(privateKeyPem);
  const nonce = newNonce();

  assert.equal(signer.publicKeyPem, publicKeyPem);
  const signature = await signer.sign('leg-1', nonce, 'succeeded', 'done');

  assert.equal(await verifyReport(publicKeyPem, 'leg-1', nonce, 'succeeded', 'done', signature), true);
  assert.equal(await verifyReport(publicKeyPem, 'leg-1', nonce, 'failed', 'done', signature), false);
  assert.equal(await verifyReport(publicKeyPem, 'leg-1', 'other-nonce', 'succeeded', 'done', signature), false);
  assert.equal(await verifyReport(publicKeyPem, 'leg-2', nonce, 'succeeded', 'done', signature), false);
});

test('the canonical message is pinned', () => {
  assert.equal(canonicalReport('leg-1', 'nonce-1', 'succeeded', 'done'), 'leg-1\nnonce-1\nsucceeded\ndone');
  assert.equal(canonicalReport('leg-1', 'nonce-1', 'succeeded', null), 'leg-1\nnonce-1\nsucceeded\n');
});

test('expiry honours an explicit now', async () => {
  const instance = await verifier();
  const claims = (await instance.verify(VECTOR.token)).claims!;

  assert.equal((await instance.verify(VECTOR.token, { now: new Date(claims.expiresAt.getTime() - 86_400_000) })).ok, true);
  assert.equal(
    (await instance.verify(VECTOR.token, { now: new Date(claims.expiresAt.getTime() + 1000) })).rejection,
    Rejection.Expired,
  );
});
