# securetron-aifw  -  Cursor hook shim

Cursor runs hooks as **local processes that speak JSON over stdio**, so a hook cannot point at the
gateway directly. This shim is the bridge: it reads the payload from stdin, forwards it to
`POST /hooks/cursor` on AI-FW, and prints the gateway's answer back to Cursor.

It carries **no policy**. Rules, allow-lists, masking and logging all live in AI-FW, so the shim only
changes when Cursor's protocol does. Two implementations are provided, Node and Python, with
identical behaviour, so a workstation needs whichever runtime it already has.

```
Cursor ──spawns──▶ securetron-aifw ──HTTPS──▶ POST /hooks/cursor ──▶ rules · allow-lists · logs
       ◀──stdout──                  ◀──JSON──
```

## Install

1. Copy this directory somewhere stable, or reference it in the project repository.
2. Put a `hooks.json` in the scope you need, based on the template here.
3. Enable the endpoint in AI-FW: **Settings → Integrations → Cursor Agent Hooks**, and give the shim a
   credential (see *The credential is required*).

| Scope | Path | Use it because | Watch out |
|---|---|---|---|
| Enterprise | `C:\ProgramData\Cursor\hooks.json`, `/etc/cursor/hooks.json`, `/Library/Application Support/Cursor/hooks.json` | A managed fleet: the host reads it whatever workspace is open and **regardless of workspace trust**, so a cloned repository cannot choose which command runs | It applies to *every* project on the machine, including untrusted ones, so the `command` must be **absolute**  -  a machine-wide file cannot carry a path relative to some project. Deploy the shim to a stable location (`C:\ProgramData\Securetron\securetron-aifw`) rather than pointing at a working copy. It is only tamper-proof if its ACL says so: by default `C:\ProgramData` lets `BUILTIN\Users` write, so an ordinary user can repoint it. Deploy it with owner `Administrators`/`SYSTEM` and users read-only |
| User | `~/.cursor/hooks.json` | Every project on one workstation, under the developer's own control | Hooks run with `~/.cursor/` as the working directory, so the command needs the absolute path to the script **and** to the interpreter |
| Project | `<repo>/.cursor/hooks.json` | Local development and per-repository work | Runs with the project root as the working directory, which is what the relative path in the template assumes, and **only in a trusted workspace** |

For a fleet, prefer the enterprise file: a project-scoped hook file is repository-supplied content, and
the trust prompt is then the only thing between a cloned repo and a command of its choosing. Keep the
project scope for development.

When more than one scope defines the same event, every matching hook runs, so the event is sent more
than once. Define it in one scope only.

```bash
AIFW_URL=https://aifw.example.com      # gateway base URL (default http://localhost)
AIFW_API_KEY=<an AI-FW API key>        # default credential mode
```

Set the environment variables where the host will see them: the user environment for a workstation
(the host inherits it at launch, so it must be restarted, not just reloaded), MDM or the host's own
distribution for a fleet. Never commit the key.

## The credential is required

There is no anonymous mode, and this is deliberate. The credential is not what protects the *hook*  -  the
host executes the configured command locally either way, and that is the same trust model Claude Code
hooks use: a local process, unsandboxed, with the developer's own privileges. The credential protects the
**gateway side**, which is where the value is:

- the records are the product. Without authentication anyone who can reach the endpoint can write
  prompts, tool calls and artifacts into **Audit Logs → Activity**, **Tools** and **Artifacts**, and a
  forged row is indistinguishable from a real one;
- those stores are now the evidence a **compliance** control cites (`telemetry_observed`, CMP-4.1.1), so
  unauthenticated writes could manufacture the evidence behind a framework control;
- the endpoint answers `allow`/`deny`/`ask`, so an open one is a free way to map the rule pack;
- `KeyId`, label and owner all come from the key registry. Anonymous rows cannot be attributed and a
  leaked secret cannot be revoked per developer.

An API key is the recommended credential: it resolves to a key id, an agent label and an owner, so every
hook decision is attributed to a person and can be revoked on its own.

For a fleet that cannot hold a per-developer key, set `AIFW_CREDENTIAL=hmac` and
`AIFW_HOOK_SECRET=<whsec_…>` instead: one shared secret, distributed with the host configuration, and no
per-developer provisioning. A signature proves possession of the shared secret only, so those calls stay
unattributed. That is the supported way to avoid issuing keys, and it is not the same as having no
credential.

To evaluate the shim with no credential at all, use capture mode: it never contacts the gateway.

## Capture what the host sends

Before enforcing anything, find out what the host actually sends and which events it fires. Pass
`--capture <dir>` (or set `AIFW_CAPTURE_DIR`) and the shim records every payload **verbatim** to
`<dir>/cursor-hooks.jsonl`  -  the payload, the event name, the working directory it was invoked with, and
the argv  -  then answers an explicit allow without contacting the gateway:

```bash
node ./securetron-aifw.mjs --capture /tmp/cursor-capture
```

A capture run cannot block anything: it answers `{"permission":"allow"}` for permission events,
`{"continue":true}` for prompts and `{}` for everything else, and it never fails the hook  -  if the
directory cannot be written the error goes to stderr and the allow answer is printed anyway. Keep the
directory **outside the repository**: captures contain raw prompts and file contents.

Use it to confirm three things that vary by Cursor build and are not worth assuming: the exact field
names each event carries, which events a given build emits at all, and the `timeout` unit (builds have
been reported reading it as seconds and as milliseconds, so a value that is long under either reading,
such as `30000`, avoids the ambiguity). If nothing is captured, suspect the path and the working
directory first, then the timeout and whether the workspace is trusted.

## Compatible with Cursor hook configuration

The hook template is designed for current Cursor builds. Verify your installed Cursor version rather than relying on
documentation, because the documentation and the builds disagree. This is what the host's own code does:

- **Config scopes.** `~/.cursor/hooks.json` (user), the workspace's `.cursor/hooks.json` (project), the
  enterprise file (`C:\ProgramData\Cursor\hooks.json`, `/etc/cursor/hooks.json`,
  `/Library/Application Support/Cursor/hooks.json`) and the team hooks the dashboard distributes. The
  host also reads **`~/.claude/settings.json`**, so Claude-format hooks are picked up too; `Bash` maps to
  `Shell`, `Edit` and `Write` both map to `Write`, and `Glob` is dropped as unsupported.
- **Event vocabulary** (21 names): `beforeSubmitPrompt`, `preToolUse`, `postToolUse`, `postToolUseFailure`,
  `beforeShellExecution`, `afterShellExecution`, `beforeMCPExecution`, `afterMCPExecution`,
  `beforeReadFile`, `afterFileEdit`, `beforeTabFileRead`, `afterTabFileEdit`, `afterAgentResponse`,
  `afterAgentThought`, `sessionStart`, `sessionEnd`, `preCompact`, `subagentStart`, `subagentStop`, `stop`,
  `workspaceOpen`. AI-FW routes 17 of them and ignores four (`afterMCPExecution`, `afterAgentThought`,
  `subagentStop`, `workspaceOpen`), answering `{}`. The template registers the 17 it routes: registering an
  ignored event only costs a process spawn and a round trip.
- **Envelope.** Every payload carries `hook_event_name`, `cursor_version`, `workspace_roots` (as URI
  paths, not filesystem paths), `user_email`, `session_id`, and `transcript_path` where the host has one,
  plus `agent_transcript_path` on `subagentStop`. The event's own fields are merged alongside them.
- **`timeout` is in seconds**, positive, warned above 3600. It is not milliseconds.
- **`failClosed` defaults to `false`.** An entry can also carry `loop_limit` (positive integer or `null`),
  and the `prompt` hook type instead of `command`.
- **`matcher` semantics depend on the event**, and it is safest to omit: a `preToolUse`/`postToolUse`
  matcher is a list of tool names from which the build drops anything it does not recognise, and if every
  name is unsupported the hook is **skipped silently**; shell events match the command text;
  `sessionStart`/`preCompact` accept only trigger words (`startup|resume|clear|compact`, `manual|auto`) and
  warn otherwise.

What this still does not prove, and what the capture mode is for: the exact field names each event
carries on the wire, whether `beforeShellExecution` really fires twice per command, which events this
build emits in an ordinary session, and how a non-zero exit is treated. Run
`| securetron-aifw.mjs --capture <dir>` for a session and read
`<dir>/cursor-hooks.jsonl`.

Whichever way that falls, a repeat of the same invocation is one row: two passes of one command collapse
into the row they already have inside the repeat window (`aifw_hooks_cursor_dedupe_ms`, default 2000 ms,
`0` records every delivery), and a refusal on the later pass replaces an earlier allow rather than being
lost with the duplicate.

## Which implementation

| Runtime | Command |
|---|---|
| Node (18+, for `fetch`) | `node ./securetron-aifw.mjs` |
| Python (3.8+, standard library only) | `python3 ./tools/securetron-aifw/securetron-aifw.py` |

On Windows, `python ./tools/securetron-aifw/securetron-aifw.py` is usually the safer path: hooks are
sometimes composed for PowerShell but executed with bash, and Python is invoked the same way in both.

## Hooks to configure

The template enables the events that matter, each with the posture its type allows:

| Event | `failClosed` | Shim flag | Why |
|---|---|---|---|
| `beforeSubmitPrompt` | `true` | `--fail-closed` | Prompts are the primary inspection point; a gateway outage should not silently pass prompts |
| `preToolUse`, `beforeShellExecution`, `beforeMCPExecution`, `beforeReadFile`, `beforeTabFileRead`, `subagentStart` | `true` | `--fail-closed` | Permission events; failing open would defeat the gate |
| `afterFileEdit`, `afterTabFileEdit`, `afterShellExecution`, `afterAgentResponse`, `postToolUse`, `postToolUseFailure`, `sessionStart`, `sessionEnd`, `preCompact`, `stop` | `false` | `--fail-open` | Notification events; they cannot block, so failing closed only loses telemetry |

`failClosed` and the shim flag are two halves of one decision and belong together: the flag is what the
shim *does* about an unreachable gateway, and `failClosed` is what the host does with a hook that failed
anyway. Setting `failClosed: true` without `--fail-closed` leaves the outcome to the host's reading of the
exit code, which is the ambiguity the flag exists to remove.

`failClosed` defaults to `false`, so it is set explicitly on every entry: an unset field is a decision
the operator did not make. The host's event vocabulary also contains `subagentStop`, `afterAgentThought`
and `workspaceOpen`, which this endpoint ignores (an unrecognised event is answered with `{}`, which is
the only safe answer for an event whose contract you have not read).

Every payload carries a common envelope  -  `hook_event_name`, `cursor_version`, `workspace_roots` (as URI
paths), `user_email`, `session_id`, and `transcript_path` where the host has one  -  plus the fields of the
event itself. AI-FW reads `conversation_id` for correlation and falls back to `session_id`, which the host
derives from the same conversation.

Two further scopes exist and are read independently of the two above: the enterprise file
(`C:\ProgramData\Cursor\hooks.json` on Windows, `/etc/cursor/hooks.json` on Linux,
`/Library/Application Support/Cursor/hooks.json` on macOS) and the team hooks the dashboard distributes.
Note also that the host reads **`~/.claude/settings.json`** as well, so a Claude hook configuration on the
same machine is consumed by Cursor too.

`timeout` is **in seconds** and is set above AI-FW's own decision budget (Settings → Cursor Agent Hooks →
*Decide Within*), which defaults to 5000 ms. If the gateway exceeds its budget it refuses rather than
leaving the editor waiting, so the hook timeout only needs to absorb network transit. Values above 3600
are accepted but warned about.

`matcher` is optional, and **leaving it out is the safe default**, which is what the template does.
It is worth knowing why before adding one: a `preToolUse` matcher is a list of tool names, names the
build does not support are dropped, and if *every* name in the matcher is unsupported the hook is
skipped silently  -  the install still looks healthy. For shell events the matcher is matched against the
command rather than a tool name, and `sessionStart`/`preCompact` accept only trigger words
(`startup|resume|clear|compact`, `manual|auto`), warning and firing for all triggers otherwise. If you
add one, confirm with a capture that the hook still fires.

## Failure behaviour

When the gateway cannot be reached, the shim's answer depends on the posture you configure **per
event** on the command line:

| Command flag | What it does when no decision can be obtained |
|---|---|
| `--fail-closed` | Answers an explicit refusal in the shape the event expects: `{"continue":false,"user_message":…}` for prompts, `{"permission":"deny","user_message":…}` for permission events. Exit 0, because it is a decision. |
| `--fail-open` | Answers the benign shape (`{}` / allow). Exit 0. |
| *(neither)* | Prints nothing and exits non-zero, leaving the decision to the host's own `failClosed` setting. This is the default for a config that does not opt in. |

Use the posture that matches each event's `failClosed` in the table above: `--fail-closed` exactly where
you set `failClosed: true`. They are two halves of one decision, and setting one without the other is
how a hook ends up failing open.

**Why not leave it to `failClosed` alone.** It looked equivalent, but it is not: a host that reads a
non-zero exit as "no decision" fails open *no matter what the configuration says*, and Cursor has been
reported doing exactly that for exit codes other than 0 and 2. An outage would then silently permit
commands while the configuration claimed otherwise. Saying the refusal here removes that dependency  -  the
outcome is the one the operator chose, in every host.

The message the developer sees in that case is fixed and does not come from the gateway (which is, after
all, unreachable): *"AI-FW could not be reached, so this action was not checked and policy could not be
applied."*

Once installed, `securetron-aifw` writing to stderr means a real problem: read the message, it names
the HTTP status or the missing variable. In the posture-driven paths above it is stderr *and* a valid
answer on stdout, which is why the refusal still reaches the developer.

## Windows notes

Three field reports worth knowing, all handled by this shim:

- Cursor has been seen prefixing the payload with a UTF-8 BOM. Both implementations strip it.
- A hook that prints nothing on exit 0 is treated as invalid JSON, and for a permission event that
  blocks the action. The shim always writes one line, and does not print at all when it fails, so
  Cursor's own failure handling applies rather than a malformed success.
- Hooks may be composed for PowerShell but executed with bash. Use the Python implementation, or
  invoke Node/Python explicitly rather than relying on a shell builtin.

## Verifying

Feed it a payload by hand. This is exactly what Cursor pipes in:

```bash
echo '{"hook_event_name":"beforeSubmitPrompt","conversation_id":"c1","model":"claude-4.5-sonnet","user_email":"dev@example.com","prompt":"hello"}' \
  | AIFW_URL=https://aifw.example.com AIFW_API_KEY=<key> \
    node ./securetron-aifw.mjs
```

Expect one line, for example `{"continue":true}`. A blocked prompt answers
`{"continue":false,"user_message":"…"}`. Either way the decision appears in AI-FW under
**Audit Logs → Activity** with model `cursor-hook` and the session's `conversation_id` as its
correlation id.

To see what the host really sends instead, run the same command with `--capture <dir>`: it records the
payload and answers an allow, so you can compare the fields Cursor emits against the ones the endpoint
reads (**Capture what the host sends** above).

## What this is not

Hooks run on the developer's machine. A developer who edits `hooks.json`, points `AIFW_URL` elsewhere,
or runs an unmanaged Cursor build is not covered by any of it. Treat the shim as visibility and speed
bumps; the gateway remains the enforcement point for model traffic.
