#!/usr/bin/env node
/**
 * securetron-aifw  -  Cursor hook shim (Node).
 *
 * Cursor spawns hooks as local processes and talks to them over stdio, so this bridges a hook to
 * the AI-FW gateway's POST /hooks/cursor. It carries no policy on purpose: it reads the payload
 * from stdin, presents the credential, forwards the payload verbatim, and prints what the gateway
 * answers. Rules, allow-lists and logging live in AI-FW, so this file rarely needs to change.
 *
 * Behaviour Cursor's contract forces:
 *   - one JSON line on stdout, flushed, on success (Cursor reads no output as invalid JSON, and for
 *     permission events an invalid response blocks the action);
 *   - on any failure it prints nothing and exits non-zero, so Cursor applies the operator's
 *     `failClosed` setting. Printing an "allow" here would silently fail open regardless of that
 *     setting, which would be the wrong side of the decision to make for someone else.
 *
 * Capture mode (`--capture <dir>`, or AIFW_CAPTURE_DIR) is the one exception, and it exists to find
 * out what a host actually sends before any policy is enforced. It records every payload verbatim to
 * `<dir>/cursor-hooks.jsonl` and answers an explicit allow without contacting the gateway, so a
 * capture run cannot block anything. It never fails the hook: if the directory cannot be written the
 * error goes to stderr and the allow answer is printed anyway.
 *
 * Environment:
 *   AIFW_URL          gateway base URL, e.g. https://aifw.example.com   (default http://localhost)
 *   AIFW_API_KEY      AI-FW API key (default credential mode)
 *   AIFW_HOOK_SECRET  Standard Webhooks secret, used when AIFW_CREDENTIAL=hmac
 *   AIFW_CREDENTIAL   "api-key" (default) | "hmac"
 *   AIFW_TIMEOUT_MS   request timeout in milliseconds (default 10000)
 *   AIFW_CAPTURE_DIR  record payloads here and allow everything, instead of forwarding
 */

import { createHmac, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_TIMEOUT_MS = 10000;

/** Events Cursor holds the action for, so the answer has to be a decision rather than an empty object. */
const PERMISSION_EVENTS = new Set([
  'preToolUse',
  'beforeShellExecution',
  'beforeMCPExecution',
  'beforeReadFile',
  'beforeTabFileRead',
  'subagentStart',
]);

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks)));
    process.stdin.on('error', reject);
  });
}

/** Strip a UTF-8 BOM: Cursor has been observed sending one, and it breaks a naive JSON parse. */
function stripBom(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3);
  return buf;
}

/** `--capture <dir>` or `--capture=<dir>`, falling back to the environment for MDM deployments. */
function captureDir(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--capture') return argv[i + 1] || process.env.AIFW_CAPTURE_DIR || null;
    if (arg.startsWith('--capture=')) return arg.slice('--capture='.length);
  }
  return process.env.AIFW_CAPTURE_DIR || null;
}

/** The event name without parsing the payload, so an unparseable body is still attributed. */
function eventNameOf(raw) {
  try {
    const parsed = JSON.parse(raw.toString('utf8'));
    return typeof parsed?.hook_event_name === 'string' ? parsed.hook_event_name : null;
  } catch {
    return null;
  }
}

/** What this event expects back: a permission decision, a prompt verdict, or nothing at all. */
function allowAnswer(eventName) {
  if (eventName === 'beforeSubmitPrompt') return { continue: true };
  if (eventName && PERMISSION_EVENTS.has(eventName)) return { permission: 'allow' };
  return {};
}

/** Text the developer sees when the gateway could not be consulted at all. */
const UNREACHABLE = 'AI-FW could not be reached, so this action was not checked and policy could not be applied.';

/**
 * The posture the operator configured for this event: `closed` refuses when no decision could be
 * obtained, `open` lets it through, `null` leaves the decision to the host (the default, which is what
 * an older config without the flag gets).
 */
function posture(argv) {
  for (const arg of argv) {
    if (arg === '--fail-closed') return 'closed';
    if (arg === '--fail-open') return 'open';
  }
  const env = (process.env.AIFW_FAIL_POSTURE || '').trim().toLowerCase();
  if (env === 'closed' || env === 'open') return env;
  return null;
}

/**
 * The answer to give when the gateway is unreachable, in the shape this event expects. Deferring to the
 * host's `failClosed` looked equivalent but is not: a host that reads a non-zero exit as "no decision"
 * fails open no matter what the config says, so an outage would silently permit commands. Saying it here
 * makes the outcome the operator chose reachable by construction. `open` answers benignly rather than
 * failing, so the host has a valid response in both postures.
 */
function failureAnswer(eventName, mode) {
  if (mode === 'closed') {
    if (eventName === 'beforeSubmitPrompt') return { continue: false, user_message: UNREACHABLE };
    if (eventName && PERMISSION_EVENTS.has(eventName)) return { permission: 'deny', user_message: UNREACHABLE };
  }
  return allowAnswer(eventName);
}

/**
 * Record the payload verbatim and answer an allow. Deliberately never throws: a capture run is a
 * diagnostic, so a full disk must not turn into a refused command. The failure is reported on stderr,
 * which is where Cursor surfaces hook output.
 */
function capture(raw, dir, argv) {
  const eventName = eventNameOf(raw);
  const record = {
    receivedAt: new Date().toISOString(),
    cwd: process.cwd(),
    argv,
    eventName,
    raw: raw.toString('utf8'),
  };
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'cursor-hooks.jsonl'), `${JSON.stringify(record)}\n`, 'utf8');
  } catch (err) {
    process.stderr.write(`securetron-aifw: capture failed: ${err && err.message ? err.message : String(err)}\n`);
  }
  return allowAnswer(eventName);
}

/** Standard Webhooks: HMAC-SHA256 over "{id}.{timestamp}.{body}", base64, prefixed "v1,". */
function signatureHeaders(secret, body) {
  const id = `msg_${randomUUID().replace(/-/g, '')}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const encoded = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  let key;
  try {
    key = Buffer.from(encoded, 'base64');
    if (key.length === 0) key = Buffer.from(encoded, 'utf8');
  } catch {
    key = Buffer.from(encoded, 'utf8');
  }
  const mac = createHmac('sha256', key).update(`${id}.${timestamp}.`).update(body).digest('base64');
  return {
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${mac}`,
  };
}

function buildHeaders(body) {
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  const mode = (process.env.AIFW_CREDENTIAL || 'api-key').trim().toLowerCase();
  if (mode === 'hmac') {
    const secret = process.env.AIFW_HOOK_SECRET;
    if (!secret) throw new Error('AIFW_HOOK_SECRET is required when AIFW_CREDENTIAL=hmac');
    Object.assign(headers, signatureHeaders(secret, body));
    return headers;
  }
  const key = process.env.AIFW_API_KEY;
  if (!key) throw new Error('AIFW_API_KEY is required');
  headers.authorization = `Bearer ${key}`;
  return headers;
}

async function main() {
  const argv = process.argv.slice(2);
  const raw = stripBom(await readStdin());
  if (raw.length === 0) throw new Error('no hook payload on stdin');

  // Capture first, before any decision: the point is to see the payload as it arrives.
  const dir = captureDir(argv);
  if (dir) {
    process.stdout.write(`${JSON.stringify(capture(raw, dir, argv))}\n`, () => process.exit(0));
    return;
  }

  const eventName = eventNameOf(raw);
  const base = (process.env.AIFW_URL || 'http://localhost').replace(/\/+$/, '');
  const timeoutMs = Number.parseInt(process.env.AIFW_TIMEOUT_MS || '', 10) || DEFAULT_TIMEOUT_MS;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(`${base}/hooks/cursor`, {
        method: 'POST',
        headers: buildHeaders(raw),
        body: raw,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = (await response.text()).trim();
    if (!response.ok) throw new Error(`gateway returned HTTP ${response.status}: ${text.slice(0, 200)}`);
    if (text.length === 0) throw new Error('gateway returned an empty body');

    // One line, flushed. The gateway already answered in the shape this event expects.
    process.stdout.write(`${JSON.stringify(JSON.parse(text))}\n`, () => process.exit(0));
  } catch (err) {
    const mode = posture(argv);
    // No posture configured: leave the decision to the host, which is what an older config expects. The
    // global handler reports it once, so nothing is printed here.
    if (mode === null) throw err;
    process.stderr.write(`securetron-aifw: ${err && err.message ? err.message : String(err)}\n`);
    process.stdout.write(`${JSON.stringify(failureAnswer(eventName, mode))}\n`, () => process.exit(0));
  }
}

main().catch((err) => {
  process.stderr.write(`securetron-aifw: ${err && err.message ? err.message : String(err)}\n`);
  process.exit(1);
});
