# Spec: Harden the agent skill wrapper (run.mjs signals/exit code, preflight false positives)

- **Issue**: [#18](https://github.com/jkas2016/hostdoc/issues/18)
- **Date**: 2026-06-25
- **Source**: `deep-code-review` (2026-06-23)

## Problem

The agent skill wrapper (`skills/hostdoc/scripts/`) shells out to the hostdoc CLI.
Its process/signal handling and readiness probe have robustness defects:

**Important**
1. **`run.mjs:43` — signals not forwarded.** A programmatic `SIGINT/SIGTERM/SIGHUP`
   sent to the wrapper is not relayed, so the child CLI (or its `npx` child) is
   orphaned.
2. **`run.mjs:58` — signal death reported as exit 1.** The `close` handler binds
   only `code` and exits `code ?? 1`. A signal-killed child has `code=null`, so a
   signal exit is misreported as a generic exit 1 (the `128 + signum` convention
   is lost).
3. **`preflight.mjs:19` — npx cold-start timeout false positive.** `configPresent`
   runs the runner with a 10s hard timeout. The default `npx -y hostdoc` fallback
   often needs a first-run download that exceeds 10s; `spawnSync` then returns
   `status=null` and the probe reports **"No hostdoc config found"** even when a
   config exists. It cannot tell a launch failure from "no config".

**Minor**
4. **`run.mjs:44` — unbounded stderr buffer.** The child's entire stderr is
   accumulated for the process lifetime (grows without bound for long-running
   commands with large stderr).
5. **`run.mjs:18` — `HOSTDOC_BIN` whitespace split.** `.split(/\s+/)` breaks a
   path containing spaces into wrong argv tokens (no injection risk).
6. **`run.mjs:14` — `onPath` executability unchecked.** `existsSync` only, so a
   non-executable file or a directory named `hostdoc` on PATH is chosen over the
   `npx` fallback.
7. **`preflight.mjs:12` — no unit tests for `credsPresent`/`configPresent`.** Only
   the subprocess "both missing" path is covered.

## Goal

Signals reach the child and the wrapper exits with the correct `128+signum` code;
the preflight probe distinguishes a slow/failed launch ("unknown") from "no
config"; stderr is bounded; `HOSTDOC_BIN` survives spaces via quoting; `onPath`
only matches executable files; and the readiness helpers have unit tests.

## Approach (decided)

Refactor the impure I/O in `run.mjs`/`preflight.mjs` around small **pure helpers**
so each finding gets a deterministic unit test, while `main()` wires them to real
process I/O. Signal/exit-code behavior is covered by spawning the wrapper around a
fake child and asserting the relayed effect and the wrapper's exit code (POSIX;
skipped on Windows where these signals differ).

These are plain ESM `.mjs` files (no TypeScript); new helpers are added as named
exports and imported by `test/skill.test.ts`.

## Changes

### `skills/hostdoc/scripts/run.mjs`

- **`splitCommand(s)`** (new export, finding 5): tokenize honoring `"…"`/`'…'`
  quotes via `/"([^"]*)"|'([^']*)'|(\S+)/g`. `resolveRunner` uses it for
  `HOSTDOC_BIN`.
- **`onPath`** (finding 6): replace `existsSync` with an `isExecutableFile` check —
  `statSync(p).isFile()` plus, on POSIX, `accessSync(p, X_OK)`; on win32 keep the
  extension list with `isFile()` only (X_OK is unreliable there). Wrapped in
  try/catch → `false`.
- **`clampTail(buf, chunk, cap = 65536)`** (new export, finding 4): return
  `(buf + chunk)` trimmed to its last `cap` chars. `main` keeps a rolling
  `errTail` string instead of an unbounded `errChunks` array; `classifyError`
  runs on `errTail`.
- **Signal forwarding** (finding 1): after spawn,
  `for (const sig of ["SIGINT","SIGTERM","SIGHUP"]) process.on(sig, () => child.kill(sig));`
- **Exit code** (finding 2): `child.on("close", (code, signal) => …)`; when
  `signal` is set, `process.exit(128 + (os.constants.signals[signal] ?? 0))`,
  else `process.exit(code ?? 1)`. (`import { constants as osConstants } from "node:os"`.)

### `skills/hostdoc/scripts/preflight.mjs`

- **`classifyConfigProbe(res)`** (new export, finding 3): `"unknown"` when
  `res.error || res.signal || res.status === null`; else `"present"` when
  `res.status === 0 && /mode:/.test(res.stdout || "")`; else `"absent"`.
- **`configState(env)`** (new export): run the runner's `config` with a **60s**
  timeout and return `classifyConfigProbe(res)`. (Replaces the boolean
  `configPresent`; `credsPresent` is unchanged.)
- **`main()`**: `"absent"` → existing "No hostdoc config found…" guidance;
  `"unknown"` → a distinct message ("Could not verify hostdoc config (the CLI was
  slow to start, e.g. a cold `npx` download)…"); creds check unchanged.

## Test plan (TDD: tests first) — `test/skill.test.ts`

- **`splitCommand`** (finding 5): `"node /x/cli.js"` → `["node","/x/cli.js"]`;
  `'node "/x/my cli.js"'` → `["node","/x/my cli.js"]`; `"a  b"` → `["a","b"]`;
  `""` → `[]`.
- **`onPath`** (finding 6): non-executable file (mode `0o644`) → `false`;
  executable (`0o755`) → `true`; a directory named like the tool → `false`.
  (Existing `resolveRunner`/`onPath` cases use `0o755`, so they keep passing.)
- **`clampTail`** (finding 4): `clampTail("", "abc", 10)` → `"abc"`;
  `clampTail("abcdefghij", "KLM", 10)` → `"defghijKLM"` (keeps last 10).
- **signal forwarding** (finding 1, POSIX-only): `HOSTDOC_BIN` = a `.cjs` sleeper
  that traps `SIGTERM`, writes a marker file, then exits 0. `spawn` the wrapper,
  wait for the child's `ready` line, send `SIGTERM` to the wrapper, await close →
  assert the marker file exists.
- **signal exit code** (finding 2, POSIX-only): `HOSTDOC_BIN` = a `.cjs` sleeper
  with no handler that prints `ready` and idles. `spawn` the wrapper, wait for
  `ready`, send `SIGTERM`, await close → assert the wrapper's exit code is `143`
  (`128 + 15`).
- **`classifyConfigProbe`** (findings 3, 7): `{status:0, stdout:"mode: x"}` →
  `"present"`; `{status:1, stdout:""}` → `"absent"`;
  `{status:null, signal:"SIGTERM"}` → `"unknown"`;
  `{error:new Error("timeout"), status:null}` → `"unknown"`.
- **`credsPresent`** (finding 7): `AWS_ACCESS_KEY_ID` / `AWS_PROFILE` /
  `AWS_SESSION_TOKEN` each → `true`; empty env + a home dir with `.aws/credentials`
  → `true`; empty env + empty home → `false`.
- Existing preflight subprocess test ("both missing → guidance") still passes:
  `config` exits 1 → `classifyConfigProbe` → `"absent"` → the same
  `/No hostdoc config/i` guidance.

## Acceptance criteria (from issue)

- [ ] `SIGTERM`/`SIGINT` sent to the wrapper reach the child, and a signal exit is
      reported with the correct exit code.
- [ ] `preflight` distinguishes a cold-start timeout from "no config".
- [ ] Unit tests are added for the new branches.

## Non-goals

- Changing the error-classification `RULES` or the skill's `SKILL.md`/docs copy.
- Bundling the scripts into npm (`files` stays `dist` only).
- Windows signal semantics (signal tests are POSIX-only).

## References

- Skill layout (CLI shell-out only): `skills/hostdoc/` (`CLAUDE.md` — Agent skill)
- Node `os.constants.signals` for `128 + signum`.
