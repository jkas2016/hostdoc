# hostdoc Agent Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an installable agent skill at repo-root `skills/hostdoc/` that wraps the hostdoc CLI so agents can publish/list/open/remove docs conversationally, with no global install required.

**Architecture:** A thin wrapper. `scripts/run.mjs` is the single chokepoint that resolves the CLI (`HOSTDOC_BIN` override → `hostdoc` on PATH → `npx -y hostdoc`) and passes args through verbatim, classifying failures into guidance. `scripts/preflight.mjs` does AWS-free readiness checks (config + credentials). `SKILL.md` instructs the agent; `references/` carry the full flag map and error table. No hosting logic is duplicated.

**Tech Stack:** Node ≥22.12 ESM (`.mjs`, no build step, no new deps), vitest (existing), the published `hostdoc` CLI.

## Global Constraints

- **No logic reimplementation:** every action shells out to the `hostdoc` CLI. (Spec non-goal)
- **No credential handling/storage** in the skill. (Spec non-goal)
- **No new runtime dependencies**; scripts are plain Node ESM. Node floor `>=22.12`.
- **No package.json / tsconfig changes:** `tsconfig.json` is `include: ["src"]`, `rootDir: "src"`; `skills/**` and `test/**` are outside build + `tsgo` typecheck. Skill is NOT bundled into npm `files`.
- **CI stays AWS-free / network-free / Terraform-free.** Tests drive the CLI via the dev path `node --import tsx <repo>/src/index.ts` (no build, no npm fetch) with an isolated `XDG_CONFIG_HOME`.
- **Runner resolution order is fixed:** `HOSTDOC_BIN` (whitespace-split argv) → `hostdoc` on PATH → `npx -y hostdoc`.
- **Skill source location:** repo-root `skills/hostdoc/` (Vercel skills flat layout), not `.claude/skills/`.
- New tests live in `test/skill.test.ts` (the existing `test/smoke.test.ts` is an unrelated placeholder — leave it).

---

### Task 1: Runner resolver + reactive error classifier (`run.mjs`)

**Files:**
- Create: `skills/hostdoc/scripts/run.mjs`
- Test: `test/skill.test.ts`

**Interfaces:**
- Consumes: the `hostdoc` CLI via a resolved argv prefix.
- Produces:
  - `export function onPath(name, env = process.env): boolean` — true if an executable `name` exists in a `PATH` directory (Windows: also `.cmd`/`.exe`).
  - `export function resolveRunner(env = process.env): string[]` — argv prefix; `HOSTDOC_BIN.split(/\s+/)` if set, else `["hostdoc"]` if `onPath("hostdoc")`, else `["npx","-y","hostdoc"]`.
  - `export function classifyError(stderr: string): string | null` — maps known stderr patterns to a one-line guidance string, or `null`.
  - CLI behavior: `node run.mjs <args…>` execs the resolved runner with `<args…>`, streams stdout/stderr live, and on non-zero exit appends a `hostdoc-skill: <guidance>` line when `classifyError` matches. Exits with the child's status.

- [ ] **Step 1: Write the failing tests**

Create `test/skill.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const runMjs = join(repo, "skills", "hostdoc", "scripts", "run.mjs");
const devBin = `node --import tsx ${join(repo, "src", "index.ts")}`;

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "hostdoc-skill-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("run.mjs", () => {
  it("resolves the CLI and passes args through verbatim", () => {
    const env = {
      PATH: process.env.PATH,
      HOME: tmp,
      HOSTDOC_BIN: devBin,
      XDG_CONFIG_HOME: tmp,
      HOSTDOC_BUCKET: "demo-bucket",
      HOSTDOC_REGION: "us-east-1",
    };
    const res = spawnSync("node", [runMjs, "config"], { encoding: "utf8", env });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("mode: s3-website");
    expect(res.stdout).toContain("bucket: demo-bucket");
  });

  it("classifies a failing command into guidance and still forwards raw stderr", () => {
    const fake = join(tmp, "fake.mjs");
    writeFileSync(fake, "console.error('CredentialsProviderError: token expired'); process.exit(1);\n");
    const env = { PATH: process.env.PATH, HOSTDOC_BIN: `node ${fake}` };
    const res = spawnSync("node", [runMjs, "publish", "x"], { encoding: "utf8", env });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/credentials are missing or expired/i);
    expect(res.stderr).toContain("CredentialsProviderError"); // raw output preserved
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/skill.test.ts`
Expected: FAIL — `run.mjs` does not exist (spawn error / non-zero status, assertions unmet).

- [ ] **Step 3: Write the minimal implementation**

Create `skills/hostdoc/scripts/run.mjs`:

```js
#!/usr/bin/env node
// Thin wrapper around the hostdoc CLI: resolve a runner, pass args through,
// stream output live, and turn known failures into actionable guidance.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

export function onPath(name, env = process.env) {
  const exts = process.platform === "win32" ? [name, `${name}.cmd`, `${name}.exe`] : [name];
  return (env.PATH || "")
    .split(delimiter)
    .filter(Boolean)
    .some((dir) => exts.some((e) => existsSync(join(dir, e))));
}

export function resolveRunner(env = process.env) {
  if (env.HOSTDOC_BIN) return env.HOSTDOC_BIN.split(/\s+/).filter(Boolean);
  if (onPath("hostdoc", env)) return ["hostdoc"];
  return ["npx", "-y", "hostdoc"];
}

const RULES = [
  [/CredentialsProviderError|session expired|ExpiredToken|reauthenticate|could not load credentials/i,
    "AWS credentials are missing or expired. Provide them via env vars, --profile, or re-run your SSO login, then retry."],
  [/no config|No configuration|config not found|run [`']?hostdoc setup/i,
    "No hostdoc config found. Run `setup` for an HTTP S3-website bucket, or `provision` for an HTTPS custom domain."],
  [/NoSuchBucket/i,
    "The configured bucket does not exist. Run `setup` to create it, or correct the bucket in your config."],
  [/already exists/i,
    "That slug is already taken. Re-run with --force to overwrite, or choose a different --slug."],
  [/Throttl|Rate exceeded|SlowDown/i,
    "AWS throttled the request (hostdoc retries with backoff). Wait a moment and retry if it persists."],
];

export function classifyError(stderr) {
  for (const [re, msg] of RULES) if (re.test(stderr)) return msg;
  return null;
}

function main(argv) {
  const [cmd, ...prefix] = resolveRunner();
  const child = spawn(cmd, [...prefix, ...argv], { stdio: ["inherit", "inherit", "pipe"] });
  let err = "";
  child.stderr.on("data", (d) => {
    err += d;
    process.stderr.write(d);
  });
  child.on("error", (e) => {
    process.stderr.write(`hostdoc-skill: could not launch the hostdoc CLI: ${e.message}\n`);
    process.exit(127);
  });
  child.on("close", (code) => {
    if (code !== 0) {
      const hint = classifyError(err);
      if (hint) process.stderr.write(`\nhostdoc-skill: ${hint}\n`);
    }
    process.exit(code ?? 1);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/skill.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: PASS (all existing tests + the 2 new ones).

- [ ] **Step 6: Commit**

```bash
git add skills/hostdoc/scripts/run.mjs test/skill.test.ts
git commit -m "feat(skill): add hostdoc runner resolver with reactive error guidance (#5)"
```

---

### Task 2: AWS-free preflight checks (`preflight.mjs`)

**Files:**
- Create: `skills/hostdoc/scripts/preflight.mjs`
- Modify: `test/skill.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: `resolveRunner` from `./run.mjs`; the CLI's AWS-free `config` command.
- Produces:
  - `export function credsPresent(env = process.env, home = os.homedir()): boolean` — true if `AWS_ACCESS_KEY_ID` / `AWS_PROFILE` / `AWS_SESSION_TOKEN` is set, or `~/.aws/credentials` or `~/.aws/config` exists.
  - `export function configPresent(env = process.env): boolean` — runs `<runner> config` and returns true iff it exits 0 and prints a `mode:` line.
  - CLI behavior: `node preflight.mjs` prints `hostdoc-skill: ready` (exit 0) when config + creds are present, else prints one `hostdoc-skill: <guidance>` line per missing item to stderr (exit 1). Never emits a stack trace.

- [ ] **Step 1: Write the failing test**

Append to `test/skill.test.ts`:

```ts
const preflightMjs = join(repo, "skills", "hostdoc", "scripts", "preflight.mjs");

describe("preflight.mjs", () => {
  it("reports missing config and credentials as guidance, not a stack trace", () => {
    const env = {
      PATH: process.env.PATH,
      HOME: tmp, // empty temp home → no ~/.aws
      HOSTDOC_BIN: devBin,
      XDG_CONFIG_HOME: tmp, // empty → no saved config, no HOSTDOC_* set
    };
    const res = spawnSync("node", [preflightMjs], { encoding: "utf8", env });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/No hostdoc config/i);
    expect(res.stderr).toMatch(/No AWS credentials/i);
    expect(res.stderr).not.toMatch(/\bat .*:\d+:\d+/); // no JS stack frames
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/skill.test.ts -t "preflight"`
Expected: FAIL — `preflight.mjs` does not exist.

- [ ] **Step 3: Write the minimal implementation**

Create `skills/hostdoc/scripts/preflight.mjs`:

```js
#!/usr/bin/env node
// AWS-free readiness checks: is hostdoc configured, and are AWS credentials
// likely available? Prints actionable guidance instead of letting a command
// fail deep with a raw error.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRunner } from "./run.mjs";

export function credsPresent(env = process.env, home = homedir()) {
  if (env.AWS_ACCESS_KEY_ID || env.AWS_PROFILE || env.AWS_SESSION_TOKEN) return true;
  return existsSync(join(home, ".aws", "credentials")) || existsSync(join(home, ".aws", "config"));
}

export function configPresent(env = process.env) {
  const [cmd, ...prefix] = resolveRunner(env);
  const res = spawnSync(cmd, [...prefix, "config"], { encoding: "utf8", env });
  return res.status === 0 && /mode:/.test(res.stdout || "");
}

function main() {
  const problems = [];
  if (!configPresent())
    problems.push("No hostdoc config found. Run `setup` (HTTP S3-website) or `provision` (HTTPS custom domain) first.");
  if (!credsPresent())
    problems.push("No AWS credentials detected. Provide them via env vars, --profile, or SSO before publishing.");
  if (problems.length) {
    for (const p of problems) process.stderr.write(`hostdoc-skill: ${p}\n`);
    process.exit(1);
  }
  process.stdout.write("hostdoc-skill: ready\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/skill.test.ts -t "preflight"`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add skills/hostdoc/scripts/preflight.mjs test/skill.test.ts
git commit -m "feat(skill): add AWS-free preflight config/credential checks (#5)"
```

---

### Task 3: SKILL.md + references, with a structure test

**Files:**
- Create: `skills/hostdoc/SKILL.md`
- Create: `skills/hostdoc/references/commands.md`
- Create: `skills/hostdoc/references/troubleshooting.md`
- Modify: `test/skill.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: `scripts/run.mjs` and `scripts/preflight.mjs` (referenced by the agent at runtime).
- Produces: a discoverable skill — `SKILL.md` with `name: hostdoc` and a `description`, plus `references/commands.md` and `references/troubleshooting.md`.

- [ ] **Step 1: Write the failing structure test**

Append to `test/skill.test.ts`:

```ts
import { readFileSync, existsSync } from "node:fs";

describe("skill structure", () => {
  const skillDir = join(repo, "skills", "hostdoc");
  it("has SKILL.md with name+description frontmatter", () => {
    const fm = readFileSync(join(skillDir, "SKILL.md"), "utf8").match(/^---\n([\s\S]*?)\n---/);
    expect(fm).toBeTruthy();
    expect(fm![1]).toMatch(/^name:\s*hostdoc\s*$/m);
    expect(fm![1]).toMatch(/^description:\s*\S+/m);
  });
  it("ships the wrapper scripts and references", () => {
    for (const f of [
      "scripts/run.mjs",
      "scripts/preflight.mjs",
      "references/commands.md",
      "references/troubleshooting.md",
    ]) {
      expect(existsSync(join(skillDir, f))).toBe(true);
    }
  });
});
```

> Note: `readFileSync`/`existsSync` are imported once at the top of the file; if Task-1's version already imports them, do not duplicate the import.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/skill.test.ts -t "structure"`
Expected: FAIL — `SKILL.md` / references do not exist.

- [ ] **Step 3: Create `skills/hostdoc/SKILL.md`**

```markdown
---
name: hostdoc
description: Publish a local HTML file or folder to the user's own AWS and return a short shareable link, and manage published docs. Use when the user says things like "publish this HTML/folder", "get a shareable link for this doc", "list/open/remove my published docs", or "set up hosting on my AWS". Wraps the hostdoc CLI — it does not reimplement any logic.
---

# hostdoc

Drive the [`hostdoc`](https://www.npmjs.com/package/hostdoc) CLI to publish local
HTML to the user's own AWS and return a short link. This skill only shells out to
the CLI; it never reimplements upload/provision logic and never handles AWS
credentials itself.

## Running the CLI

Always invoke the CLI through the wrapper so resolution and error guidance are
consistent — never call `hostdoc` directly:

```bash
node <skill>/scripts/run.mjs <command> [args…]
```

`<skill>` is this skill's directory. The wrapper resolves the CLI in order:
`HOSTDOC_BIN` (override) → `hostdoc` on `PATH` → `npx -y hostdoc`. So it works
whether or not the user installed hostdoc globally — no global install required.

## Workflow

1. **Preflight before any AWS-touching command** (`publish`, `list`, `open`,
   `rm`, `provision`, `deprovision`):

   ```bash
   node <skill>/scripts/preflight.mjs
   ```

   If it reports missing config or credentials, relay that guidance and help the
   user resolve it instead of running the command. (`config`/`--help` need no
   preflight.)

2. **Map the request to a command** (see `references/commands.md` for all flags):
   - "publish this file/folder", "share this doc" → `publish <path>` (`--slug`,
     `--title`, `--force`, `--open`, `--dry-run`)
   - "list my docs" → `list`
   - "open <id>" → `open <id>`
   - "remove/delete <id>" → `rm <id> --yes`
   - "set up hosting" → `setup --bucket <name> --region <r>` (HTTP S3-website)
   - "set up a custom domain / HTTPS" → `provision --hosted-zone <z> --subdomain
     <s> --region <r>` (add `--approve` when running non-interactively)

3. **Run it** through `run.mjs` and **return the printed URL/result** to the user.

4. **On failure**, the wrapper prints a `hostdoc-skill:` guidance line — relay it.
   For unmapped errors see `references/troubleshooting.md`.

## Two hosting modes

- **s3-website** (default, HTTP): created by `setup`; links look like
  `http://<bucket>.s3-website-<region>.amazonaws.com/<code>/`.
- **cloudfront** (HTTPS, custom domain): provisioned by `provision` (Terraform,
  ~15–30 min); links look like `https://<subdomain>.<zone>/<code>/`.

`config` (AWS-free) prints the active mode. Full flags, config precedence, and the
credential model are in `references/commands.md`.
```

- [ ] **Step 4: Create `skills/hostdoc/references/commands.md`**

```markdown
# hostdoc command reference

All commands run as `node <skill>/scripts/run.mjs <command> [args…]`.

## Config precedence & credentials

- Precedence: CLI flags > `HOSTDOC_*` env > `~/.config/hostdoc/config.json`.
- Common overrides (most commands): `--profile <name>`, `--region <region>`,
  `--bucket <name>`, `--domain <domain>`, `--distribution <id>`.
- Credentials use the AWS SDK default chain (env vars, shared profile via
  `--profile`, or SSO). The skill never stores or forwards credentials.

## Commands

| Command | Purpose | Key flags |
| --- | --- | --- |
| `publish <path>` | Upload a file/folder; prints the public URL | `--slug <name>`, `--title <t>`, `--force`, `--open`, `--dry-run` |
| `list` | List published documents | common overrides |
| `open <id>` | Print/open a doc's URL | common overrides |
| `rm <id>` | Delete a doc by code or slug | `--yes` (skip confirm) |
| `config` | Show the active configuration (AWS-free) | common overrides |
| `setup` | Create a public S3-website bucket + save config | `--bucket <name>` (req), `--region <r>` (req), `--profile <name>` |
| `provision` | Provision HTTPS/CloudFront via Terraform | `--hosted-zone <z>`, `--subdomain <s>`, `--region <r>`, `--price-class <c>`, `--dir <d>`, `--approve` |
| `deprovision` | Tear down the domain infra | `--hosted-zone <z>`, `--subdomain <s>`, `--region <r>`, `--dir <d>`, `--approve` |
| `init --from-terraform <dir>` | Import existing Terraform outputs into a cloudfront config | — |

## Agent / non-interactive notes

- `provision` and `deprovision` prompt for Terraform approval unless `--approve`
  is passed — always pass `--approve` when driving non-interactively.
- `rm` prompts unless `--yes` is passed.
- `provision` is long-running (~15–30 min); its output streams live through the
  wrapper.

> Note: `publish --dry-run` currently still makes an AWS call to check slug/code
> availability, so it needs valid credentials. (Tracked as a separate CLI
> follow-up to make dry-run fully offline.)
```

- [ ] **Step 5: Create `skills/hostdoc/references/troubleshooting.md`**

```markdown
# hostdoc troubleshooting

The wrapper (`run.mjs`) appends a `hostdoc-skill:` guidance line for known
failures. Mapping:

| Symptom (in stderr) | Guidance |
| --- | --- |
| `CredentialsProviderError`, `session expired`, `ExpiredToken`, "could not load credentials" | Credentials missing/expired — set env vars, pass `--profile`, or re-run SSO login, then retry. |
| "No config" / "No configuration" / "run `hostdoc setup`" | Not configured — run `setup` (HTTP S3-website) or `provision` (HTTPS custom domain). |
| `NoSuchBucket` | Configured bucket doesn't exist — run `setup` or fix the bucket in config. |
| "already exists" (slug) | Slug taken — re-run with `--force` or pick a different `--slug`. |
| `Throttling`, `Rate exceeded`, `SlowDown` | AWS throttled; hostdoc retries with backoff — wait and retry. |

## Preflight

Run `node <skill>/scripts/preflight.mjs` before AWS-touching commands. It checks:

- **Config present** — via the AWS-free `config` command.
- **Credentials likely present** — `AWS_ACCESS_KEY_ID` / `AWS_PROFILE` /
  `AWS_SESSION_TOKEN` env, or `~/.aws/{credentials,config}`.

It does not validate credentials against AWS (no STS call), so an expired token
still surfaces at run time — handled by the reactive mapping above.

## CLI not found

If neither a global `hostdoc` nor `npx` can run it, the wrapper prints
"could not launch the hostdoc CLI". Ensure Node ≥22.12 and network access for the
first `npx -y hostdoc`, or install globally with `npm i -g hostdoc`.
```

- [ ] **Step 6: Run the structure test to verify it passes**

Run: `npx vitest run test/skill.test.ts -t "structure"`
Expected: PASS.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS (all tests).

- [ ] **Step 8: Commit**

```bash
git add skills/hostdoc/SKILL.md skills/hostdoc/references/ test/skill.test.ts
git commit -m "feat(skill): add SKILL.md, command + troubleshooting references (#5)"
```

---

### Task 4: User-facing docs (README + CLAUDE.md)

**Files:**
- Modify: `README.md` (add a "Use with an agent" section)
- Modify: `CLAUDE.md` (one line noting the skill location)

**Interfaces:**
- Consumes: nothing. Documentation only.
- Produces: install + usage docs for the skill.

- [ ] **Step 1: Add a "Use with an agent (skill)" section to `README.md`**

Insert after the "Domain mode" section (before any Development/Contributing
section). Replace `jkas2016/hostdoc` only if the repo slug differs.

```markdown
## Use with an agent (skill)

`hostdoc` ships an installable [agent skill](https://vercel.com/docs/agent-resources/skills)
so coding agents can drive it conversationally — "publish this folder", "list my
docs", "remove that slug" — without memorizing flags.

```bash
npx skills add jkas2016/hostdoc
```

This installs the `hostdoc` skill into your agent. The skill shells out to the
`hostdoc` CLI, preferring a global install and falling back to `npx -y hostdoc`,
so **no global install is required**. It runs an AWS-free preflight check and
turns missing config/credentials into guidance instead of raw errors.

Example prompts: *"publish ./report.html and give me the link"*, *"list my
published docs"*, *"open aws-design"*, *"remove aws-design"*.
```

- [ ] **Step 2: Add the skill location note to `CLAUDE.md`**

In the **Architecture** section's `Layers` bullet, append a sentence:

Find:
```
- **Layers**: `src/index.ts` (Commander) → `src/commands/*` (one per subcommand) → `src/lib/*` (AWS, terraform shell-out, config, walk/mime/meta, code, url, browser).
```
Replace with:
```
- **Layers**: `src/index.ts` (Commander) → `src/commands/*` (one per subcommand) → `src/lib/*` (AWS, terraform shell-out, config, walk/mime/meta, code, url, browser).
- **Agent skill**: `skills/hostdoc/` (repo-root, Vercel skills layout — not `.claude/skills/`) wraps the CLI via `scripts/run.mjs` (PATH→`npx` fallback) + `scripts/preflight.mjs`. It shells out only; not bundled into npm `files`. Distributed via `npx skills add jkas2016/hostdoc`.
```

- [ ] **Step 3: Verify docs mention the install command and the suite still passes**

Run: `grep -q "npx skills add" README.md && grep -q "skills/hostdoc/" CLAUDE.md && echo OK`
Expected: `OK`

Run: `npm test`
Expected: PASS (unchanged — docs-only task).

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document the hostdoc agent skill and npx skills install (#5)"
```

---

## Out of scope (follow-up issue)

`publish --dry-run` makes a `ListObjectsV2` call before returning the URL
(`src/commands/publish.ts`, via `uniqueCode`/slug-collision check), so it is not
credential-free. File a separate issue to make `--dry-run` AWS-free; once shipped,
the skill can use it for offline URL previews. Not part of this PR.

## Self-review

- **Spec coverage:** runner PATH→npx fallback → Task 1; reactive classifier →
  Task 1; active-light preflight (config + creds, AWS-free) → Task 2; SKILL.md +
  references (anatomy) → Task 3; CI-safe smoke tests (structure, runner+passthrough,
  preflight guidance) + reactive-classifier test → Tasks 1–3; `npx skills add`
  distribution + README + CLAUDE.md → Task 4; npx review (no package change) →
  reflected in Global Constraints / no package.json edit; dry-run finding → Out of
  scope section. All spec sections mapped.
- **No package bundling / tsconfig change:** confirmed `include: ["src"]`; no edits
  to `package.json` or `tsconfig.json` in any task.
- **Type consistency:** `resolveRunner`/`onPath`/`classifyError` (Task 1) are the
  exact names imported/used in Task 2 (`resolveRunner`) and tested in Task 1;
  `credsPresent`/`configPresent` (Task 2) match their test usage; `run.mjs` and
  `preflight.mjs` paths are identical across SKILL.md, references, and tests.
- **Placeholders:** none — every script and doc is shown in full.
```
