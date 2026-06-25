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

Targeted fixes plus small, idiomatic test seams. For finding 1 the buggy logic
(derive the code from the published URL, forward overrides to `runOpen`) is
extracted into a tested helper in `src/commands/open.ts`; `index.ts` then calls
it. This is preferred over an `import.meta`-main guard on `index.ts` because the
npm `bin` is installed as a symlink (the guard's `argv[1]` comparison is fragile
there) and because importing `index.ts` from a test would run its top-level
`program.parseAsync()`. The helper carries the regression guard with neither
risk.

## Changes

### 1. `src/commands/open.ts` + `src/index.ts` (finding 1 + test seam)

- Add `export function openPublishedUrl(url: string, overrides?: Overrides): string`
  to `open.ts`: derive the code via `url.split("/").slice(-2, -1)[0]` and return
  `runOpen({ id, ...overrides })`.
- `index.ts` publish action: replace `runOpen({ id: url.split(...) })` with
  `openPublishedUrl(url, overrides(opts))`. `index.ts` stays auto-running (no
  main-guard); tests import only `open.ts`.

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

### `test/publish-open.test.ts` (new) — finding 1

- `vi.mock("../src/lib/browser.js")` (stub `openInBrowser`) to avoid real spawns.
  With ambient `HOSTDOC_BUCKET=envbkt`, assert
  `openPublishedUrl("http://envbkt.../abc/", { bucket: "flagbkt", region: "us-east-1" })`
  returns `http://flagbkt.s3-website-us-east-1.amazonaws.com/abc/` (overrides win),
  and that the no-override call falls back to `envbkt`. Also assert the stubbed
  `openInBrowser` was called with the override URL. → issue acceptance criterion 1.

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
