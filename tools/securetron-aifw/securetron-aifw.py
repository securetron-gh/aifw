#!/usr/bin/env python3
"""securetron-aifw  -  Cursor hook shim (Python).

Cursor spawns hooks as local processes and talks to them over stdio, so this bridges a hook to the
AI-FW gateway's POST /hooks/cursor. It carries no policy on purpose: it reads the payload from
stdin, presents the credential, forwards the payload verbatim, and prints what the gateway answers.
Rules, allow-lists and logging live in AI-FW, so this file rarely needs to change.

Behaviour Cursor's contract forces:
  - one JSON line on stdout, flushed, on success (Cursor reads no output as invalid JSON, and for
    permission events an invalid response blocks the action);
  - on any failure it prints nothing and exits non-zero, so Cursor applies the operator's
    ``failClosed`` setting. Printing an "allow" here would silently fail open regardless of that
    setting, which is not this process's decision to make.

Capture mode (``--capture <dir>``, or AIFW_CAPTURE_DIR) is the one exception, and it exists to find
out what a host actually sends before any policy is enforced. It records every payload verbatim to
``<dir>/cursor-hooks.jsonl`` and answers an explicit allow without contacting the gateway, so a
capture run cannot block anything. It never fails the hook: if the directory cannot be written the
error goes to stderr and the allow answer is printed anyway.

Environment:
  AIFW_URL          gateway base URL, e.g. https://aifw.example.com   (default http://localhost)
  AIFW_API_KEY      AI-FW API key (default credential mode)
  AIFW_HOOK_SECRET  Standard Webhooks secret, used when AIFW_CREDENTIAL=hmac
  AIFW_CREDENTIAL   "api-key" (default) | "hmac"
  AIFW_TIMEOUT_MS   request timeout in milliseconds (default 10000)
  AIFW_CAPTURE_DIR  record payloads here and allow everything, instead of forwarding

Standard library only, so a machine needs a Python interpreter and nothing else.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

DEFAULT_TIMEOUT_MS = 10_000


def read_stdin_bytes() -> bytes:
    """Read the payload to EOF. Cursor closes stdin, so this terminates."""
    return sys.stdin.buffer.read()


def strip_bom(data: bytes) -> bytes:
    """Strip a UTF-8 BOM: Cursor has been observed sending one, and it breaks a naive JSON parse."""
    return data[3:] if data.startswith(b"\xef\xbb\xbf") else data


#: Events Cursor holds the action for, so the answer has to be a decision rather than an empty object.
PERMISSION_EVENTS = frozenset(
    {
        "preToolUse",
        "beforeShellExecution",
        "beforeMCPExecution",
        "beforeReadFile",
        "beforeTabFileRead",
        "subagentStart",
    }
)


def capture_dir(argv: list[str]) -> str | None:
    """``--capture <dir>`` or ``--capture=<dir>``, falling back to the environment for MDM deployments."""
    for index, arg in enumerate(argv):
        if arg == "--capture":
            return (argv[index + 1] if index + 1 < len(argv) else None) or os.environ.get("AIFW_CAPTURE_DIR")
        if arg.startswith("--capture="):
            return arg[len("--capture="):]
    return os.environ.get("AIFW_CAPTURE_DIR")


def event_name_of(raw: bytes) -> str | None:
    """The event name without trusting the payload, so an unparseable body is still attributed."""
    try:
        parsed = json.loads(raw.decode("utf-8", "replace"))
    except ValueError:
        return None
    name = parsed.get("hook_event_name") if isinstance(parsed, dict) else None
    return name if isinstance(name, str) else None


def allow_answer(event_name: str | None) -> dict:
    """What this event expects back: a permission decision, a prompt verdict, or nothing at all."""
    if event_name == "beforeSubmitPrompt":
        return {"continue": True}
    if event_name in PERMISSION_EVENTS:
        return {"permission": "allow"}
    return {}


#: Text the developer sees when the gateway could not be consulted at all.
UNREACHABLE = (
    "AI-FW could not be reached, so this action was not checked and policy could not be applied."
)


def posture(argv: list[str]) -> str | None:
    """`closed` refuses when no decision could be obtained, `open` lets it through, `None` defers to the host."""
    for arg in argv:
        if arg == "--fail-closed":
            return "closed"
        if arg == "--fail-open":
            return "open"
    env = os.environ.get("AIFW_FAIL_POSTURE", "").strip().lower()
    return env if env in ("closed", "open") else None


def failure_answer(event_name: str | None, mode: str) -> dict:
    """The answer to give when the gateway is unreachable, in the shape this event expects.

    Deferring to the host's ``failClosed`` looked equivalent but is not: a host that reads a non-zero exit
    as "no decision" fails open no matter what the config says, so an outage would silently permit
    commands. Saying it here makes the outcome the operator chose reachable by construction.
    """
    if mode == "closed":
        if event_name == "beforeSubmitPrompt":
            return {"continue": False, "user_message": UNREACHABLE}
        if event_name in PERMISSION_EVENTS:
            return {"permission": "deny", "user_message": UNREACHABLE}
    return allow_answer(event_name)


def capture(raw: bytes, directory: str, argv: list[str]) -> dict:
    """Record the payload verbatim and answer an allow.

    Deliberately never raises: a capture run is a diagnostic, so a full disk must not turn into a
    refused command. The failure is reported on stderr, which is where Cursor surfaces hook output.
    """
    event_name = event_name_of(raw)
    record = {
        "receivedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "cwd": os.getcwd(),
        "argv": argv,
        "eventName": event_name,
        "raw": raw.decode("utf-8", "replace"),
    }
    try:
        os.makedirs(directory, exist_ok=True)
        with open(os.path.join(directory, "cursor-hooks.jsonl"), "a", encoding="utf-8") as sink:
            sink.write(json.dumps(record, separators=(",", ":")) + "\n")
    except OSError as exc:
        sys.stderr.write(f"securetron-aifw: capture failed: {exc}\n")
    return allow_answer(event_name)


def decode_secret(secret: str) -> bytes:
    """Standard Webhooks secrets are base64 after the ``whsec_`` prefix; tolerate a raw value."""
    encoded = secret[len("whsec_"):] if secret.startswith("whsec_") else secret
    try:
        key = base64.b64decode(encoded, validate=True)
        return key or encoded.encode("utf-8")
    except Exception:
        return encoded.encode("utf-8")


def signature_headers(secret: str, body: bytes) -> dict[str, str]:
    """Standard Webhooks: HMAC-SHA256 over ``{id}.{timestamp}.{body}``, base64, prefixed ``v1,``."""
    message_id = "msg_" + uuid.uuid4().hex
    timestamp = str(int(time.time()))
    mac = hmac.new(
        decode_secret(secret),
        f"{message_id}.{timestamp}.".encode("utf-8") + body,
        hashlib.sha256,
    ).digest()
    return {
        "webhook-id": message_id,
        "webhook-timestamp": timestamp,
        "webhook-signature": "v1," + base64.b64encode(mac).decode("ascii"),
    }


def build_headers(body: bytes) -> dict[str, str]:
    headers = {"content-type": "application/json", "accept": "application/json"}
    mode = os.environ.get("AIFW_CREDENTIAL", "api-key").strip().lower()
    if mode == "hmac":
        secret = os.environ.get("AIFW_HOOK_SECRET")
        if not secret:
            raise RuntimeError("AIFW_HOOK_SECRET is required when AIFW_CREDENTIAL=hmac")
        headers.update(signature_headers(secret, body))
        return headers
    key = os.environ.get("AIFW_API_KEY")
    if not key:
        raise RuntimeError("AIFW_API_KEY is required")
    headers["authorization"] = f"Bearer {key}"
    return headers


def main() -> int:
    argv = sys.argv[1:]
    raw = strip_bom(read_stdin_bytes())
    if not raw:
        raise RuntimeError("no hook payload on stdin")

    # Capture first, before any decision: the point is to see the payload as it arrives.
    directory = capture_dir(argv)
    if directory:
        answer = capture(raw, directory, argv)
        sys.stdout.write(json.dumps(answer, separators=(",", ":")) + "\n")
        sys.stdout.flush()
        return 0

    event_name = event_name_of(raw)
    base = os.environ.get("AIFW_URL", "http://localhost").rstrip("/")
    try:
        timeout_ms = int(os.environ.get("AIFW_TIMEOUT_MS", "") or DEFAULT_TIMEOUT_MS)
    except ValueError:
        timeout_ms = DEFAULT_TIMEOUT_MS

    try:
        request = urllib.request.Request(
            f"{base}/hooks/cursor", data=raw, headers=build_headers(raw), method="POST"
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout_ms / 1000) as response:
                text = response.read().decode("utf-8", "replace").strip()
        except urllib.error.HTTPError as err:
            detail = err.read().decode("utf-8", "replace").strip()[:200]
            raise RuntimeError(f"gateway returned HTTP {err.code}: {detail}") from err

        if not text:
            raise RuntimeError("gateway returned an empty body")

        # One line, flushed. The gateway already answered in the shape this event expects.
        sys.stdout.write(json.dumps(json.loads(text), separators=(",", ":")) + "\n")
        sys.stdout.flush()
        return 0
    except Exception as exc:  # noqa: BLE001 - the message goes to the host's log
        mode = posture(argv)
        # No posture configured: leave the decision to the host, which is what an older config expects.
        # The top-level handler reports it once, so nothing is written here.
        if mode is None:
            raise
        sys.stderr.write(f"securetron-aifw: {exc}\n")
        sys.stdout.write(json.dumps(failure_answer(event_name, mode), separators=(",", ":")) + "\n")
        sys.stdout.flush()
        return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 - the message goes to Cursor's log, nothing to retry
        sys.stderr.write(f"securetron-aifw: {exc}\n")
        sys.exit(1)
