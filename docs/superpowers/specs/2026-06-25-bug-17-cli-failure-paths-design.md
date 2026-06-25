# Spec: Harden CLI failure paths (publish --open override, browser spawn, dev-mode templates)

- **Issue**: [#17](https://github.com/jkas2016/hostdoc/issues/17)
- **Date**: 2026-06-25
- **Source**: `deep-code-review` (2026-06-23)

## Problem

Three independent robustness defects on CLI failure paths. The happy path works;
these only bite on override use, a missing browser opener, or running from source.

1. **`src/index.ts:156` — `publish --open` drops resolved overrides.** The
   in-process `runOpen({ id })` call omits `...overrides(opts)`, so
   `runOpen → resolveOpenUrl → resolveConfig` re-resolves config with no flags. A
   publish that succeeded via `--bucket/--region/--domain/--distribution/--profile`
   then opens a *different* config's URL, or throws "No configuration found" even
   though the upload just succeeded. Every other call site (`index.ts:189`) passes
   `...overrides(opts)`.

2. **`src/lib/browser.ts:14` — `spawn()` has no `'error'` listener.** The opener
   is fire-and-forget (`detached` + `stdio:"ignore"` + `unref`). When the opener
   binary is absent (e.g. `xdg-open` on headless Linux), the unhandled `'error'`
   event surfaces as an uncaught exception and crashes the CLI *after* the URL was
   already printed.

3. **`src/lib/templates.ts:18` — source runs (`npm run dev`) ENOENT on provision.**
   `bundledTemplatesDir()` resolves `../templates/infra/` from `import.meta.url`.
   Built/global installs resolve to `dist/templates/infra/` (correct), but the
   documented "run from source" path (tsx via `npm run dev`) resolves to the
   non-existent `src/templates/infra/` (templates are generated into `dist/` at
   build time only). Because the default provision target is a fresh per-user dir
   with no `.tf`, `extractTemplates` does not short-circuit and `copyFileSync`
   throws **ENOENT** → `npm run dev -- provision` fails.

## Goal

Overrides flow through `publish --open`; a missing browser opener degrades to a
printed "open this URL" hint instead of a crash; `npm run dev -- provision`
resolves templates from the repo `infra/` when no bundled copy exists.

## Approach (decided)

Targeted fixes plus small, idiomatic test seams. The repo already uses an
`import.meta`-main guard in `skills/hostdoc/scripts/*.mjs`; we apply the same
pattern to `src/index.ts` so the Commander wiring becomes testable in-process.

## Changes

### 1. `src/index.ts` (finding 1 + test seam)

- Publish action: `runOpen({ id: <code>, ...overrides(opts) })` (mirror other call
  sites).
- Wrap the bottom `program.parseAsync()` in an `import.meta`-main guard and
  `export` the `program` so a test can drive `program.parseAsync(argv, { from: "user" })`
  in-process. This matches the existing guard convention in the skill scripts and
  is the only way to regression-test the Commander call site without real AWS.

### 2. `src/lib/browser.ts` (finding 2)

- `openInBrowser(url, opener = openerCommand(process.platform))` — inject the
  opener (default unchanged) for testability; return the `ChildProcess`.
- Attach `child.on("error", (e) => process.stderr.write(...))` **before** `unref()`,
  printing an actionable hint that includes the URL (e.g.
  `Couldn't open a browser automatically. Open this URL manually:\n<url>`), so a
  missing opener never crashes the CLI.

### 3. `src/lib/templates.ts` (finding 3)

- Add pure helper `firstExistingDir(dirs: string[], exists = existsSync): string`
  returning the first existing dir (last entry as fallback when none exist).
- `bundledTemplatesDir()` returns
  `firstExistingDir([<dist/templates/infra>, <repo infra/>])`. In a built/global
  install the bundled dir exists and wins; from source it falls back to the repo
  `infra/`, which contains all six `TEMPLATE_FILES` (verified, incl. the dotfile
  `.terraform.lock.hcl`). The npm package ships only `dist/`, so the bundled dir
  is always present there and the fallback is never reached in published installs.

## Test plan (TDD: tests first)

### `test/index.test.ts` (new) — finding 1

- Set `HOSTDOC_BUCKET`/`HOSTDOC_REGION` to an "env" config, mock S3
  (`aws-sdk-client-mock`) and `openInBrowser` (vi.mock). Drive
  `program.parseAsync(["publish", <dir>, "--open", "--bucket", "flagbkt", "--region", "us-east-1"], { from: "user" })`
  and assert `openInBrowser` was called with the **flagbkt** URL, not the env one.
  → issue acceptance criterion 1.

### `test/open.test.ts` — finding 2

- `openInBrowser(url, { cmd: "__no_such_opener__", args: u => [u] })` does **not**
  throw; spy on `process.stderr.write` and, after the child's `'error'` event,
  assert the hint containing the URL was written. → issue acceptance criterion 2.

### `test/templates.test.ts` — finding 3

- Pure `firstExistingDir`: returns first existing; returns last entry when none
  exist; honors an injected `exists` predicate.
- `extractTemplates(<fresh dir>)` with the **default** `srcDir` (i.e.
  `bundledTemplatesDir()`) succeeds in the from-source/test context (resolves to
  repo `infra/`) and copies every `TEMPLATE_FILE` — the direct regression for the
  ENOENT path. → issue acceptance criterion 3.

## Acceptance criteria (from issue)

- [ ] After publishing with override flags, `--open` opens the URL for the **same**
      config (test added).
- [ ] A missing browser opener prints a manual-URL hint instead of crashing.
- [ ] `npm run dev -- provision` works (templates resolve from repo `infra/`).

## Non-goals

- Changing opener selection per platform (`openerCommand` is unchanged).
- Any change to provisioning/Terraform behavior beyond template path resolution.
- Reworking config precedence or mode derivation (covered by #15).

## References

- Mode/provisioning + "run from source" path: `CLAUDE.md` (Architecture, Gotchas)
- Existing `import.meta`-main guard pattern: `skills/hostdoc/scripts/run.mjs`
