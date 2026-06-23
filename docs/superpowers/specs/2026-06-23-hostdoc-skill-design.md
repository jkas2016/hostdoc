# Wrap the hostdoc CLI as an installable agent skill

**Issue:** [jkas2016/hostdoc#5](https://github.com/jkas2016/hostdoc/issues/5)
**Date:** 2026-06-23
**Status:** Approved — ready for implementation plan

## Problem

`hostdoc` ships as a CLI. To let people and coding agents drive it conversationally
("publish this folder", "list my docs", "remove that slug") without memorizing flags, we
want an installable **agent skill** that orchestrates the already-installed `hostdoc`
binary. The skill must not reimplement publish/provision logic, must not bundle AWS
credentials, and must not require a global install to be usable.

A usability concern surfaced during brainstorming: for the skill to work without forcing a
global `npm i -g hostdoc`, the CLI must be runnable via `npx`. This was verified (see npx
review below) and shapes the runner strategy.

## Goal

After `npx skills add jkas2016/hostdoc`, an agent can publish a local HTML file/folder to
the user's own AWS and return the public URL — using the installed `hostdoc` (PATH) or
`npx -y hostdoc` as a fallback, with **zero global install required**. Missing
config/credentials produce actionable guidance, not a raw stack trace.

## npx review (verified)

- `npx -y hostdoc@1.0.1 --help` runs cold end-to-end. The published package has a `bin`
  with a `#!/usr/bin/env node` shebang and (since #9) bundled Terraform templates.
- **No package changes are required** for the skill. The skill defaults to an `npx`
  fallback so it works with no global install.

## Decisions made during brainstorming

1. **Runner strategy = PATH first → npx fallback.** A single resolver picks, in order:
   `HOSTDOC_BIN` env override → `hostdoc` on PATH → `npx -y hostdoc`. Installed users get
   the fast path; everyone else works immediately via npx.
2. **Source location = repo-root `skills/hostdoc/`.** Per the Vercel skills convention,
   skills are authored in a top-level `skills/` directory (flat layout
   `skills/<name>/SKILL.md`); `.claude/skills/` is the *consumer* install location, not the
   authoring location. ([Vercel docs](https://vercel.com/docs/agent-resources/skills),
   [vercel-labs/skills](https://github.com/vercel-labs/skills))
3. **Distribution = `npx skills add jkas2016/hostdoc`.** The skills CLI installs directly
   from the GitHub repo — no registry submission, no npm bundling. The CLI (npm) and the
   skill (skills ecosystem) are decoupled; neither requires the other to be globally
   installed.
4. **Script language = Node `.mjs`.** `hostdoc` already requires Node ≥22.12, so Node is
   guaranteed present; `.mjs` is cross-platform (incl. Windows) and parses config JSON /
   error output cleanly. Matches the repo's Node/TS stack.
5. **Preflight = active-light + reactive fallback.** Before mutating commands, check config
   existence (via the AWS-free `config` command) and a credentials heuristic (env vars /
   `~/.aws` files) — no STS probe, no AWS CLI dependency. On command failure, classify
   stderr into friendly guidance.
6. **Smoke test = `config`-based, CI-safe.** No AWS, no network, no Terraform — consistent
   with the existing CI policy. `publish` is excluded from the CI smoke test because
   `publish --dry-run` is not AWS-free (see adjacent finding).
7. **The `publish --dry-run` finding is out of scope** for this PR and recommended as a
   separate follow-up issue (see Adjacent finding).

## Architecture

The skill is a thin, layered wrapper. SKILL.md instructs the agent; `scripts/` are helpers
the agent invokes via its shell; `references/` hold the full flag map and the
error→guidance table. No hosting logic is duplicated — every action shells out to the CLI.

### Repo layout

```
skills/hostdoc/
  SKILL.md                # frontmatter (name, description+triggers) + workflow playbook
  scripts/
    run.mjs               # runner resolver + arg passthrough (the single chokepoint)
    preflight.mjs         # active-light config/creds checks + reactive stderr classifier
  references/
    commands.md           # per-command flag map, config precedence, credential model
    troubleshooting.md    # stderr pattern → guidance table
```

`assets/` is omitted: the skill-creator anatomy treats it as optional (only when there are
real assets to ship), and the CI smoke test is `config`-based, so no fixture is needed
(YAGNI). The test's tiny HTML input is created inline by the test, not committed.

### Components

**`scripts/run.mjs` — runner resolution.** The one place the PATH→npx decision lives.
Resolution order: `HOSTDOC_BIN` env (explicit override, e.g. `node <repo>/dist/index.js`
for tests/advanced use) → `hostdoc` on PATH (`command -v`) → `npx -y hostdoc`. Passes all
remaining argv through verbatim with inherited stdio. Returns the CLI's exit code. SKILL.md
and the agent never repeat the fallback logic — they always call
`node <skill>/scripts/run.mjs <command> …`.

**`scripts/preflight.mjs` — readiness checks.**
- *Active (before mutating commands, zero AWS calls):* run `run.mjs config`; if it fails
  with a no-config pattern, emit guidance (`setup` for s3-website, `provision` for
  HTTPS/CloudFront). Credentials heuristic: presence of `AWS_ACCESS_KEY_ID` /
  `AWS_PROFILE` / `AWS_SESSION_TOKEN`, or `~/.aws/{credentials,config}`; if none, emit
  guidance (env vars, `--profile`, or SSO).
- *Reactive (on command failure):* classify stderr into known patterns and surface a
  friendly message instead of a stack trace — e.g. `CredentialsProviderError` / `session
  expired` → reauthenticate; `NoSuchBucket` → run `setup`; `Slug "x" already exists` →
  `--force`; `Throttling` → backoff is automatic, retry.
- No STS probe; the skill never reimplements AWS.

**`SKILL.md` — agent instructions.**
- Frontmatter: `name: hostdoc`; `description` carrying trigger phrases ("publish this
  HTML/folder", "get a shareable link", "list/open/remove my docs", "set up hosting on my
  AWS").
- Workflow: preflight → map the natural-language request to a command + flags → run via
  `run.mjs` → return the URL/result → on failure apply the guidance from preflight's
  classifier.
- Mode awareness: s3-website (HTTP, `setup`) vs cloudfront (HTTPS, `provision`, with the
  non-interactive `--approve` for agents). Full flags live in `references/commands.md`;
  SKILL.md stays thin.

### Wrapped command surface

`setup` · `init --from-terraform` · `provision`/`deprovision` (`--approve`) ·
`publish <path>` (`--slug --title --force --open --dry-run` + common
`--profile/--region/--bucket/--domain/--distribution`) · `list` · `rm <id> --yes` ·
`open <id>` · `config`. Argument mapping and URL passthrough are documented in
`references/commands.md`.

## Data flow

```
natural-language request
  → SKILL.md selects command + flags
  → preflight.mjs (config + creds; AWS-free)        ── missing → guidance, stop
  → run.mjs <command> [args]  (PATH | npx)
      → hostdoc CLI  → AWS (user's account)
  → URL / result on stdout                           ── returned to user
      └─ on non-zero exit → reactive stderr classifier → guidance
```

## Error handling

- All raw failures are intercepted: preflight's reactive classifier maps known stderr
  patterns to guidance; unknown errors are surfaced verbatim but framed (never a bare stack
  trace as the only output).
- Preflight stops before mutating commands when config or credentials are absent, so the
  agent guides the user instead of triggering a deep failure (e.g. a 15–30 min `provision`).

## Testing — `test/skill.test.ts` (vitest, CI-safe: no AWS, no network, no Terraform)

Reuses the existing `test/setup-env.ts` pattern (temp `XDG_CONFIG_HOME` + `HOSTDOC_*`
env). The runner is pointed at the local build via `HOSTDOC_BIN="node <repo>/dist/index.js"`
to avoid an npm network fetch.

1. **Structure:** SKILL.md frontmatter parses and has `name` + `description`; `run.mjs`,
   `preflight.mjs`, and `references/*` exist.
2. **Runner resolution + passthrough:** `run.mjs config` (with `HOSTDOC_BUCKET`/`REGION`
   env) prints output containing `mode` and `bucket` — verifies resolution and verbatim arg
   passthrough, AWS-free.
3. **Preflight guidance:** empty config + no creds env → preflight emits a guidance string,
   not a stack trace.

`publish` is intentionally excluded from CI: `publish --dry-run` makes a `ListObjectsV2`
call before returning the URL (see below), so it is not AWS-free.

## Adjacent finding (out of scope — recommend a separate issue)

`publish --dry-run` calls `existsPrefix` (`ListObjectsV2`, an AWS call) before returning the
URL — via `uniqueCode` when no slug is given, and via the slug-collision check when one is
(`src/commands/publish.ts`). So `--dry-run` requires credentials, and an agent cannot
preview a URL offline / credential-free. This is a CLI behavior change, separate from
"wrap the CLI as a skill"; per one-task-one-PR it is **not** part of this PR. Recommended
follow-up issue: *"Make `publish --dry-run` AWS-free — skip the existence check so an
unconfigured/credential-free URL preview works."* Once shipped, the skill can use dry-run
for URL previews.

## PR deliverables

- `skills/hostdoc/` tree: `SKILL.md`, `scripts/run.mjs`, `scripts/preflight.mjs`,
  `references/commands.md`, `references/troubleshooting.md`.
- `test/skill.test.ts` — the three CI-safe smoke tests above.
- README "Use with an agent" section: `npx skills add jkas2016/hostdoc` + trigger phrases.
- CLAUDE.md: one line noting the skill location (`skills/hostdoc/`).

## Non-goals

- Reimplementing publish/provision logic inside the skill (it wraps the CLI only).
- Bundling or storing AWS credentials.
- A new distribution channel we build/maintain (the skills ecosystem `npx skills add` is an
  existing channel, not new infrastructure).
- Fixing `publish --dry-run` (separate follow-up issue).
