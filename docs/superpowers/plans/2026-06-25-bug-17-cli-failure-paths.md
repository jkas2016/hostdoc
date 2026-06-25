# CLI Failure-Path Hardening (#17) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `publish --open` honor override flags, stop a missing browser opener from crashing the CLI, and let `npm run dev -- provision` find the Terraform templates.

**Architecture:** Three independent, file-local fixes in `src/`, each with a small TDD seam: extract `openPublishedUrl` into `open.ts` (forward overrides), add a `'error'` handler + injectable opener to `browser.ts`, and add a `firstExistingDir` fallback to `templates.ts`.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Commander, Vitest, `aws-sdk-client-mock`.

## Global Constraints

- ESM: relative imports in `.ts` need a `.js` extension (e.g. `./commands/open.js`).
- CI runs build→typecheck→test with **no AWS creds and no Terraform**; tests must not touch live AWS or spawn real browsers/processes.
- Node engine floor: `>=22.12`.
- Match existing style; only add seams the fixes need. No unrelated refactoring.
- Each task ends green on `npm test`; full gate (`npm run build && npm run typecheck && npm test`) runs once before push.
- Branch: `fix/17-cli-failure-paths` (already created off `main`). Commit per task.

---

### Task 1: `publish --open` forwards overrides

**Files:**
- Modify: `src/commands/open.ts` (add `openPublishedUrl`)
- Modify: `src/index.ts:156` (use the helper)
- Test: `test/publish-open.test.ts` (create)

**Interfaces:**
- Consumes: `runOpen(args: { id: string } & Overrides): string`, `type Overrides` — both from `src/commands/open.ts` / `src/lib/config.ts` (existing).
- Produces: `openPublishedUrl(url: string, overrides?: Overrides): string` — derives the code from a published URL and opens it with the given overrides; returns the resolved URL.

- [ ] **Step 1: Write the failing test**

Create `test/publish-open.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/lib/browser.js", () => ({
  openInBrowser: vi.fn(),
  openerCommand: () => ({ cmd: "noop", args: (u: string) => [u] }),
}));

import { openPublishedUrl } from "../src/commands/open.js";
import { openInBrowser } from "../src/lib/browser.js";

beforeEach(() => {
  process.env.HOSTDOC_BUCKET = "envbkt";
  process.env.HOSTDOC_REGION = "us-east-1";
  vi.mocked(openInBrowser).mockClear();
});
afterEach(() => {
  delete process.env.HOSTDOC_BUCKET;
  delete process.env.HOSTDOC_REGION;
});

describe("openPublishedUrl", () => {
  it("forwards overrides so the opened URL matches the override config", () => {
    const url = openPublishedUrl(
      "http://envbkt.s3-website-us-east-1.amazonaws.com/abc/",
      { bucket: "flagbkt", region: "us-east-1" },
    );
    expect(url).toBe("http://flagbkt.s3-website-us-east-1.amazonaws.com/abc/");
    expect(openInBrowser).toHaveBeenCalledWith(
      "http://flagbkt.s3-website-us-east-1.amazonaws.com/abc/",
    );
  });

  it("falls back to ambient config when no overrides are given", () => {
    const url = openPublishedUrl(
      "http://envbkt.s3-website-us-east-1.amazonaws.com/abc/",
    );
    expect(url).toBe("http://envbkt.s3-website-us-east-1.amazonaws.com/abc/");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/publish-open.test.ts`
Expected: FAIL — `openPublishedUrl` is not exported from `open.ts`.

- [ ] **Step 3: Add the helper to `src/commands/open.ts`**

Append to `src/commands/open.ts` (it already imports `runOpen`'s deps and `type Overrides`):

```ts
/** Open a just-published URL: derive its code and re-open under `overrides`. */
export function openPublishedUrl(url: string, overrides: Overrides = {}): string {
  const id = url.split("/").slice(-2, -1)[0];
  return runOpen({ id, ...overrides });
}
```

- [ ] **Step 4: Wire it into `src/index.ts`**

In `src/index.ts`, change the publish-command import and call site:

```ts
// near the other command imports
import { runOpen, openPublishedUrl } from "./commands/open.js";
```

```ts
// in the publish .action, replace the existing `if (opts.open ...)` line:
      if (opts.open && !opts.dryRun) openPublishedUrl(url, overrides(opts));
```

(`runOpen` is still imported because the `open <id>` command uses it.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/publish-open.test.ts`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add src/commands/open.ts src/index.ts test/publish-open.test.ts
git commit -m "fix: forward overrides through publish --open (#17)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Browser opener never crashes the CLI

**Files:**
- Modify: `src/lib/browser.ts:12-15`
- Test: `test/open.test.ts` (extend)

**Interfaces:**
- Consumes: `openerCommand(platform): { cmd: string; args: (url: string) => string[] }` (existing).
- Produces: `openInBrowser(url: string, opener?: { cmd: string; args: (url: string) => string[] }): ChildProcess` — injectable opener (default = platform opener); attaches an `'error'` handler that prints a manual-URL hint; returns the child.

- [ ] **Step 1: Write the failing test**

Add to `test/open.test.ts` — extend the imports and add a block:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveOpenUrl } from "../src/commands/open.js";
import { describeConfig } from "../src/commands/config.js";
import { openerCommand, openInBrowser } from "../src/lib/browser.js";
```

```ts
describe("openInBrowser", () => {
  it("does not throw and prints a manual hint when the opener is missing", async () => {
    const writes: string[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(((s: string | Uint8Array) => {
        writes.push(String(s));
        return true;
      }) as typeof process.stderr.write);

    const child = openInBrowser("http://x.example/abc/", {
      cmd: "__no_such_opener__",
      args: (u) => [u],
    });
    await new Promise<void>((r) => child.on("error", () => r()));
    await new Promise((r) => setImmediate(r)); // let the production handler run

    spy.mockRestore();
    expect(writes.join("")).toContain("http://x.example/abc/");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/open.test.ts -t "manual hint"`
Expected: FAIL — currently `openInBrowser` takes one arg and has no `'error'` handler, so the unhandled `'error'` surfaces (test errors / no hint written).

- [ ] **Step 3: Implement the fix in `src/lib/browser.ts`**

Replace the file body with:

```ts
import { spawn, type ChildProcess } from "node:child_process";

type Opener = { cmd: string; args: (url: string) => string[] };

export function openerCommand(platform: NodeJS.Platform): Opener {
  if (platform === "darwin") return { cmd: "open", args: (u) => [u] };
  if (platform === "win32") return { cmd: "cmd", args: (u) => ["/c", "start", "", u] };
  return { cmd: "xdg-open", args: (u) => [u] };
}

export function openInBrowser(
  url: string,
  opener: Opener = openerCommand(process.platform),
): ChildProcess {
  const child = spawn(opener.cmd, opener.args(url), {
    stdio: "ignore",
    detached: true,
  });
  child.on("error", () => {
    process.stderr.write(
      `Couldn't open a browser automatically. Open this URL manually:\n${url}\n`,
    );
  });
  child.unref();
  return child;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/open.test.ts`
Expected: PASS (existing `openerCommand`/`resolveOpenUrl`/`describeConfig` cases + the new hint case).

- [ ] **Step 5: Commit**

```bash
git add src/lib/browser.ts test/open.test.ts
git commit -m "fix: handle browser-opener spawn error instead of crashing (#17)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Templates resolve from repo `infra/` when run from source

**Files:**
- Modify: `src/lib/templates.ts:15-19`
- Test: `test/templates.test.ts` (extend)

**Interfaces:**
- Produces: `firstExistingDir(dirs: string[], exists?: (d: string) => boolean): string` — first existing dir, else the last entry.
- Changes: `bundledTemplatesDir()` now returns `firstExistingDir([<dist/templates/infra>, <repo infra/>])` (same signature).

- [ ] **Step 1: Write the failing test**

Add to `test/templates.test.ts` — extend imports and add two blocks:

```ts
import {
  extractTemplates,
  hasTfFiles,
  firstExistingDir,
  TEMPLATE_FILES,
} from "../src/lib/templates.js";
```

```ts
describe("firstExistingDir", () => {
  it("returns the first existing dir", () => {
    expect(
      firstExistingDir(["/no/a", "/yes/b", "/yes/c"], (d) => d.startsWith("/yes")),
    ).toBe("/yes/b");
  });
  it("falls back to the last entry when none exist", () => {
    expect(firstExistingDir(["/no/a", "/no/b"], () => false)).toBe("/no/b");
  });
});

describe("bundledTemplatesDir fallback (from source)", () => {
  it("extractTemplates with the default src copies every template file", () => {
    const target = join(dest, "infra-default");
    const res = extractTemplates(target); // default srcDir = bundledTemplatesDir()
    expect(res.extracted).toBe(true);
    for (const f of TEMPLATE_FILES) {
      expect(existsSync(join(target, f))).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/templates.test.ts -t "firstExistingDir"`
Expected: FAIL — `firstExistingDir` is not exported. (The default-src copy test fails today too: `bundledTemplatesDir()` resolves to the non-existent `src/templates/infra/` under tsx/vitest → ENOENT.)

- [ ] **Step 3: Implement the fix in `src/lib/templates.ts`**

Replace `bundledTemplatesDir()` and add `firstExistingDir` just above it:

```ts
/** First dir in `dirs` that exists; falls back to the last entry when none do. */
export function firstExistingDir(
  dirs: string[],
  exists: (d: string) => boolean = existsSync,
): string {
  return dirs.find((d) => exists(d)) ?? dirs[dirs.length - 1];
}

/** Path to the bundled templates. Prefers dist/templates/infra/ (shipped in the
 * npm package); from source (npm run dev) that dir is absent, so fall back to the
 * repo's infra/. */
export function bundledTemplatesDir(): string {
  const bundled = fileURLToPath(new URL("../templates/infra/", import.meta.url));
  const repoInfra = fileURLToPath(new URL("../../infra/", import.meta.url));
  return firstExistingDir([bundled, repoInfra]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/templates.test.ts`
Expected: PASS — `firstExistingDir` cases + default-src copy (resolves to repo `infra/`, copies all six `TEMPLATE_FILES`) + existing `extractTemplates`/`hasTfFiles` cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/templates.ts test/templates.test.ts
git commit -m "fix: fall back to repo infra/ for templates when run from source (#17)

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
git push -u origin fix/17-cli-failure-paths
```

- [ ] **Step 3: Open the PR (closes #17)**

```bash
gh pr create --base main --head fix/17-cli-failure-paths \
  --title "fix: harden CLI failure paths (publish --open override, browser spawn, dev-mode templates) (#17)" \
  --body "$(cat <<'EOF'
Closes #17.

Hardens three CLI failure paths found by `deep-code-review`:

- **`publish --open` drops overrides** — extract `openPublishedUrl` in `open.ts`; the publish action now forwards `overrides(opts)`, so `--open` opens the same config the publish used.
- **Browser opener crash** — `openInBrowser` attaches an `'error'` handler (and accepts an injectable opener); a missing opener prints a manual-URL hint instead of an uncaught exception.
- **Dev-mode provision ENOENT** — `bundledTemplatesDir()` falls back to the repo `infra/` via `firstExistingDir` when the bundled `dist/templates/infra/` is absent (i.e. `npm run dev`).

Acceptance criteria
- [x] After publishing with override flags, `--open` opens the same config's URL (test added).
- [x] A missing browser opener prints a manual-URL hint instead of crashing (test added).
- [x] `npm run dev -- provision` resolves templates from repo `infra/` (test added).

Spec: `docs/superpowers/specs/2026-06-25-bug-17-cli-failure-paths-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:** finding 1 → Task 1; finding 2 → Task 2; finding 3 → Task 3; acceptance criteria 1/2/3 → Tasks 1/2/3 tests; verification + push/PR → Task 4. No gaps.

**Placeholder scan:** none — every code/command step is concrete.

**Type consistency:** `openPublishedUrl(url, overrides?)`, `openInBrowser(url, opener?): ChildProcess`, `Opener = { cmd, args }`, `firstExistingDir(dirs, exists?)` are used identically across plan and tests; `Overrides` and `runOpen` reused from existing code unchanged.
