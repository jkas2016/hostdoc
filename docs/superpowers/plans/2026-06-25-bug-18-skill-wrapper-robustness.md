# Skill Wrapper Robustness (#18) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agent skill wrapper forward signals, exit with `128+signum`, bound its stderr, quote-split `HOSTDOC_BIN`, only match executable files on PATH, and have the preflight probe tell a cold-start timeout apart from "no config".

**Architecture:** Refactor `skills/hostdoc/scripts/run.mjs` and `preflight.mjs` around small pure helpers (`splitCommand`, `clampTail`, `classifyConfigProbe`, `isExecutableFile`/`onPath`) for deterministic unit tests; `main()` wires them to real process I/O. Signal behavior is covered by spawning the wrapper around fake `.cjs` children (POSIX-only).

**Tech Stack:** Plain ESM `.mjs` (no TypeScript), Node child_process/os/fs, Vitest, `spawn`/`spawnSync`.

## Global Constraints

- Files are ESM `.mjs`; helpers are named exports imported by `test/skill.test.ts`.
- CI runs build→typecheck→test with **no AWS creds and no Terraform**; tests must not need them.
- Node engine floor: `>=22.12`.
- Signal tests are POSIX-only (`it.skipIf(process.platform === "win32")`); the non-executable-file test also skips under root (X_OK is bypassed for uid 0).
- The wrapper shells out only; do not bundle scripts into npm (`files` stays `dist`).
- Branch: `fix/18-skill-wrapper-robustness` (already created off `main`). Commit per task.
- `os.constants.signals.SIGTERM === 15` → wrapper exit `143`.

---

### Task 1: run.mjs pure helpers — splitCommand, clampTail, executable onPath

**Files:**
- Modify: `skills/hostdoc/scripts/run.mjs` (imports, `onPath`, add `splitCommand` + `clampTail`, `resolveRunner` uses `splitCommand`)
- Test: `test/skill.test.ts` (extend)

**Interfaces:**
- Produces: `splitCommand(s: string): string[]` (quote-aware tokenizer); `clampTail(buf: string, chunk: string, cap?: number): string`; `onPath(name, env?)` now matches only executable files.
- Consumes: existing `resolveRunner`, `onPath` exports.

- [ ] **Step 1: Write the failing tests**

Add to `test/skill.test.ts` (inside the `describe("run.mjs unit (pure)")` block or as new top-level blocks). Extend the import line:

```ts
import {
  resolveRunner,
  onPath,
  classifyError,
  splitCommand,
  clampTail,
} from "../skills/hostdoc/scripts/run.mjs";
```

Then add:

```ts
describe("splitCommand", () => {
  it("splits on whitespace", () => {
    expect(splitCommand("node /x/cli.js")).toEqual(["node", "/x/cli.js"]);
  });
  it("keeps a double-quoted path with spaces as one token", () => {
    expect(splitCommand('node "/x/my cli.js"')).toEqual(["node", "/x/my cli.js"]);
  });
  it("collapses repeated whitespace and ignores empty input", () => {
    expect(splitCommand("a  b")).toEqual(["a", "b"]);
    expect(splitCommand("")).toEqual([]);
  });
});

describe("clampTail", () => {
  it("appends when under the cap", () => {
    expect(clampTail("", "abc", 10)).toBe("abc");
  });
  it("keeps only the last cap chars when over", () => {
    expect(clampTail("abcdefghij", "KLM", 10)).toBe("defghijKLM");
  });
});

describe("onPath executability", () => {
  it("returns false for a directory named like the tool", () => {
    mkdirSync(join(unitTmp2, "hostdoc"));
    expect(onPath("hostdoc", { PATH: unitTmp2 })).toBe(false);
  });
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "returns false for a non-executable file",
    () => {
      const bin = join(unitTmp2, "tool");
      writeFileSync(bin, "#!/bin/sh\n");
      chmodSync(bin, 0o644);
      expect(onPath("tool", { PATH: unitTmp2 })).toBe(false);
    },
  );
});
```

Add a fresh temp dir for these (near the other `beforeEach`s), and make sure `mkdirSync` is imported:

```ts
// extend the node:fs import at the top of skill.test.ts:
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
```

```ts
let unitTmp2: string;
beforeEach(() => {
  unitTmp2 = mkdtempSync(join(tmpdir(), "hostdoc-onpath-"));
});
afterEach(() => {
  rmSync(unitTmp2, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/skill.test.ts -t "splitCommand"`
Expected: FAIL — `splitCommand` is not exported.

- [ ] **Step 3: Implement the helpers in `skills/hostdoc/scripts/run.mjs`**

Replace the top of the file (imports + `onPath` + `resolveRunner`) and add the helpers:

```js
#!/usr/bin/env node
// Thin wrapper around the hostdoc CLI: resolve a runner, pass args through,
// stream output live, and turn known failures into actionable guidance.
import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants, statSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

function isExecutableFile(p) {
  try {
    if (!statSync(p).isFile()) return false;
    if (process.platform === "win32") return true; // ext-based; X_OK is unreliable
    accessSync(p, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function onPath(name, env = process.env) {
  const exts = process.platform === "win32" ? [name, `${name}.cmd`, `${name}.exe`] : [name];
  return (env.PATH || "")
    .split(delimiter)
    .filter(Boolean)
    .some((dir) => exts.some((e) => isExecutableFile(join(dir, e))));
}

/** Split a command line into argv, honoring "double" and 'single' quotes so a
 * path containing spaces survives as a single token. */
export function splitCommand(s) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s)) !== null) tokens.push(m[1] ?? m[2] ?? m[3]);
  return tokens;
}

export function resolveRunner(env = process.env) {
  if (env.HOSTDOC_BIN) return splitCommand(env.HOSTDOC_BIN);
  if (onPath("hostdoc", env)) return ["hostdoc"];
  return ["npx", "-y", "hostdoc"];
}

/** Append `chunk` to `buf`, keeping at most the last `cap` characters. */
export function clampTail(buf, chunk, cap = 65536) {
  const next = buf + chunk;
  return next.length > cap ? next.slice(next.length - cap) : next;
}
```

(The `RULES`/`classifyError` block below this stays unchanged. `existsSync` is no longer imported here.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/skill.test.ts`
Expected: PASS — new `splitCommand`/`clampTail`/`onPath` cases + existing `resolveRunner`/`onPath`/`classifyError` cases (which use `0o755`).

- [ ] **Step 5: Commit**

```bash
git add skills/hostdoc/scripts/run.mjs test/skill.test.ts
git commit -m "fix: quote-aware HOSTDOC_BIN split, bounded stderr helper, executable-only onPath (#18)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: run.mjs main — signal forwarding + correct exit code + bounded stderr

**Files:**
- Modify: `skills/hostdoc/scripts/run.mjs` (`main()` only)
- Test: `test/skill.test.ts` (extend)

**Interfaces:**
- Consumes: `clampTail`, `classifyError`, `resolveRunner` (from Task 1).
- Produces: wrapper relays `SIGINT/SIGTERM/SIGHUP` to the child; on signal death exits `128 + os.constants.signals[signal]`.

- [ ] **Step 1: Write the failing tests**

Add to `test/skill.test.ts` a new block. Needs `spawn` imported:

```ts
import { spawn, spawnSync } from "node:child_process";
```

```ts
describe("run.mjs signal handling (POSIX)", () => {
  function startWrapper(sleeperBody: string) {
    const sleeper = join(tmp, "sleeper.cjs");
    writeFileSync(sleeper, sleeperBody);
    const env = { PATH: process.env.PATH, HOSTDOC_BIN: `node ${sleeper}` };
    const proc = spawn("node", [runMjs, "publish", "x"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const ready = new Promise<void>((resolve) => {
      proc.stdout.on("data", (d) => {
        if (d.toString().includes("ready")) resolve();
      });
    });
    return { proc, ready };
  }

  it.skipIf(process.platform === "win32")(
    "forwards SIGTERM to the child",
    async () => {
      const marker = join(tmp, "got-signal");
      const { proc, ready } = startWrapper(
        `process.on('SIGTERM',()=>{require('fs').writeFileSync(${JSON.stringify(marker)},'got');process.exit(0);});` +
          `setInterval(()=>{},1000);process.stdout.write('ready\\n');`,
      );
      await ready;
      proc.kill("SIGTERM");
      await new Promise((r) => proc.on("close", r));
      expect(existsSync(marker)).toBe(true);
    },
  );

  it.skipIf(process.platform === "win32")(
    "exits 128+SIGTERM (143) when the child is signal-killed",
    async () => {
      const { proc, ready } = startWrapper(
        `setInterval(()=>{},1000);process.stdout.write('ready\\n');`,
      );
      await ready;
      proc.kill("SIGTERM");
      const code: number = await new Promise((r) => proc.on("close", (c) => r(c)));
      expect(code).toBe(143);
    },
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/skill.test.ts -t "signal handling"`
Expected: FAIL — current wrapper does not forward signals (no marker) and reports a signal death as exit 1 (not 143).

- [ ] **Step 3: Implement the new `main()` in `skills/hostdoc/scripts/run.mjs`**

Replace the existing `main` function with:

```js
function main(argv) {
  const [cmd, ...prefix] = resolveRunner();
  const child = spawn(cmd, [...prefix, ...argv], { stdio: ["inherit", "inherit", "pipe"] });
  let errTail = "";
  child.stderr.on("data", (d) => {
    errTail = clampTail(errTail, d.toString());
    process.stderr.write(d);
  });
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => child.kill(sig));
  }
  child.on("error", (e) => {
    process.stderr.write(`hostdoc-skill: could not launch the hostdoc CLI: ${e.message}\n`);
    process.exit(127);
  });
  child.on("close", (code, signal) => {
    if (code !== 0) {
      const hint = classifyError(errTail);
      if (hint) process.stderr.write(`\nhostdoc-skill: ${hint}\n`);
    }
    if (signal) process.exit(128 + (osConstants.signals[signal] ?? 0));
    process.exit(code ?? 1);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/skill.test.ts`
Expected: PASS — signal forwarding (marker written), exit 143, plus the existing run.mjs subprocess tests (classify + passthrough).

- [ ] **Step 5: Commit**

```bash
git add skills/hostdoc/scripts/run.mjs test/skill.test.ts
git commit -m "fix: forward signals to child and exit 128+signum on signal death (#18)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: preflight — distinguish cold-start timeout from "no config" + unit tests

**Files:**
- Modify: `skills/hostdoc/scripts/preflight.mjs` (add `classifyConfigProbe` + `configState`, rewrite `main`)
- Test: `test/skill.test.ts` (extend)

**Interfaces:**
- Produces: `classifyConfigProbe(res): "present" | "absent" | "unknown"`; `configState(env?): same`; `credsPresent(env?, home?)` unchanged.
- Consumes: `resolveRunner` (run.mjs).

- [ ] **Step 1: Write the failing tests**

Add to `test/skill.test.ts`. Extend the preflight import:

```ts
import { credsPresent, classifyConfigProbe } from "../skills/hostdoc/scripts/preflight.mjs";
```

```ts
describe("classifyConfigProbe", () => {
  it("present when status 0 and stdout has mode:", () => {
    expect(classifyConfigProbe({ status: 0, stdout: "mode: s3-website\n" })).toBe("present");
  });
  it("absent when status non-zero", () => {
    expect(classifyConfigProbe({ status: 1, stdout: "" })).toBe("absent");
  });
  it("unknown when killed by signal (null status)", () => {
    expect(classifyConfigProbe({ status: null, signal: "SIGTERM" })).toBe("unknown");
  });
  it("unknown when spawn errored (timeout)", () => {
    expect(classifyConfigProbe({ error: new Error("timeout"), status: null })).toBe("unknown");
  });
});

describe("credsPresent", () => {
  it("true for any AWS_* env signal", () => {
    expect(credsPresent({ AWS_ACCESS_KEY_ID: "x" }, "/no/home")).toBe(true);
    expect(credsPresent({ AWS_PROFILE: "p" }, "/no/home")).toBe(true);
    expect(credsPresent({ AWS_SESSION_TOKEN: "t" }, "/no/home")).toBe(true);
  });
  it("true when ~/.aws/credentials exists", () => {
    const home = mkdtempSync(join(tmpdir(), "hostdoc-aws-"));
    mkdirSync(join(home, ".aws"));
    writeFileSync(join(home, ".aws", "credentials"), "[default]\n");
    expect(credsPresent({}, home)).toBe(true);
    rmSync(home, { recursive: true, force: true });
  });
  it("false with no env and an empty home", () => {
    const home = mkdtempSync(join(tmpdir(), "hostdoc-aws-"));
    expect(credsPresent({}, home)).toBe(false);
    rmSync(home, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/skill.test.ts -t "classifyConfigProbe"`
Expected: FAIL — `classifyConfigProbe` is not exported.

- [ ] **Step 3: Implement in `skills/hostdoc/scripts/preflight.mjs`**

Replace `configPresent` and `main` (keep `credsPresent`):

```js
/** Classify a `config` probe result: "unknown" when the runner could not be
 * launched or was killed (e.g. an npx cold-start timeout), so a slow launch is
 * not misreported as "no config". */
export function classifyConfigProbe(res) {
  if (res.error || res.signal || res.status === null) return "unknown";
  return res.status === 0 && /mode:/.test(res.stdout || "") ? "present" : "absent";
}

export function configState(env = process.env) {
  const [cmd, ...prefix] = resolveRunner(env);
  const res = spawnSync(cmd, [...prefix, "config"], { encoding: "utf8", env, timeout: 60000 });
  return classifyConfigProbe(res);
}

function main() {
  const problems = [];
  const cfg = configState();
  if (cfg === "absent")
    problems.push("No hostdoc config found. Run `setup` (HTTP S3-website) or `provision` (HTTPS custom domain) first.");
  else if (cfg === "unknown")
    problems.push("Could not verify hostdoc config (the CLI was slow to start, e.g. a cold `npx` download). Ensure a config exists or set HOSTDOC_BIN, then retry.");
  if (!credsPresent())
    problems.push("No AWS credentials detected. Provide them via env vars, --profile, or SSO before publishing.");
  if (problems.length) {
    for (const p of problems) process.stderr.write(`hostdoc-skill: ${p}\n`);
    process.exit(1);
  }
  process.stdout.write("hostdoc-skill: ready\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/skill.test.ts`
Expected: PASS — `classifyConfigProbe` + `credsPresent` units, and the existing preflight subprocess test (config exits 1 → `"absent"` → same `/No hostdoc config/i` + `/No AWS credentials/i` guidance).

- [ ] **Step 5: Commit**

```bash
git add skills/hostdoc/scripts/preflight.mjs test/skill.test.ts
git commit -m "fix: preflight distinguishes cold-start timeout from missing config (#18)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Full gate + push + PR

**Files:** none (verification + integration).

- [ ] **Step 1: Run the full CI-parity gate**

Run: `npm run build && npm run typecheck && npm test`
Expected: build emits `dist/`, typecheck clean, all tests PASS.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin fix/18-skill-wrapper-robustness
```

- [ ] **Step 3: Open the PR (closes #18)**

```bash
gh pr create --base main --head fix/18-skill-wrapper-robustness \
  --title "fix: harden the agent skill wrapper (signals, exit code, preflight) (#18)" \
  --body "$(cat <<'EOF'
Closes #18.

Hardens the agent skill wrapper (`skills/hostdoc/scripts/`) found by `deep-code-review`:

**Important**
- **Signal forwarding** — `run.mjs` relays `SIGINT/SIGTERM/SIGHUP` to the child so it is not orphaned.
- **Exit code** — a signal-killed child now exits `128 + signum` (e.g. 143 for SIGTERM) instead of a generic exit 1.
- **Preflight cold-start** — `classifyConfigProbe` returns `present`/`absent`/`unknown`; a slow/failed launch (e.g. cold `npx` download) is reported as "could not verify", not "no config". Timeout raised to 60s.

**Minor**
- Bounded stderr via `clampTail` (last 64 KB) instead of an unbounded buffer.
- Quote-aware `splitCommand` so `HOSTDOC_BIN` with spaces survives.
- `onPath` matches only executable files (X_OK + isFile), not directories/non-exec files.
- Unit tests added for `splitCommand`, `clampTail`, `onPath`, `classifyConfigProbe`, and `credsPresent`.

## Acceptance criteria
- [x] Signals reach the child and a signal exit reports the correct code (tests added, POSIX).
- [x] Preflight distinguishes a cold-start timeout from "no config" (tests added).
- [x] Unit tests added for the new branches.

Spec: `docs/superpowers/specs/2026-06-25-bug-18-skill-wrapper-robustness-design.md`
Plan: `docs/superpowers/plans/2026-06-25-bug-18-skill-wrapper-robustness.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:** finding 5 (splitCommand) + 4 (clampTail) + 6 (onPath) → Task 1; finding 1 (forwarding) + 2 (exit code) → Task 2; finding 3 (probe classify) + 7 (unit tests) → Task 3; verification + push/PR → Task 4. All seven findings + three acceptance criteria covered.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `splitCommand(s): string[]`, `clampTail(buf, chunk, cap?)`, `classifyConfigProbe(res): "present"|"absent"|"unknown"`, `configState(env?)`, `onPath(name, env?)`, `credsPresent(env?, home?)` are used identically across plan and tests. `osConstants.signals[signal]` drives the 143 assertion. The wrapper spawn uses `HOSTDOC_BIN=node <sleeper.cjs>` (CommonJS for `require('fs')`, since the package is `type: module`).
