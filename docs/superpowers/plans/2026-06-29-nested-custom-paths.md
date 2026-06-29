# Nested/Multi-Segment Custom Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `hostdoc publish ./x --slug team/q1/report` serve at `<host>/team/q1/report/` in both hosting modes, with `rm`/`open` accepting nested ids.

**Architecture:** The `code` variable already threads uniformly through publish/rm/open (`${code}/`, `metaKey(code)`, `buildPublicUrl(cfg, code)`, `/${code}/*`). Allowing `/` in `code` makes most of it work automatically. A new `isValidPath` validates each `/`-segment against the existing `SLUG_RE`, whose leading-`[a-z0-9]` rule already rejects traversal, `_`-leading, and empty segments. `isValidPath` replaces `isValidSlug` (a strict subset). One real bug fix: `openPublishedUrl` parses the full URL pathname instead of only the last segment.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Node.js, Commander, AWS SDK v3, Vitest + `aws-sdk-client-mock`.

## Global Constraints

- ESM: relative imports in `.ts` source MUST use a `.js` extension (e.g. `../lib/code.js`).
- CI runs build→typecheck→test with **no AWS creds and no Terraform** — keep tests AWS-mocked; never touch live AWS or run Terraform in tests.
- Tests set state via `HOSTDOC_*` env vars and mock AWS with `aws-sdk-client-mock`.
- Build is `npm run build` (`tsc`); type-check is `npm run typecheck` (`tsgo --noEmit`); tests are `npm test` / `npx vitest run <file>`.
- Meta sidecar uses the **nested** key form `_meta/team/q1/report.json` (no encode/decode).
- Do NOT change `src/lib/url.ts`, `src/lib/meta.ts`, `src/lib/walk.ts`, or `infra/index-rewrite.js` — they already handle nested prefixes. `_meta/` protection (s3-website `NotResource: .../_meta/*`, cloudfront `/_*` 403) already covers nested sidecars; no infra change.

---

### Task 1: Add `isValidPath` validator

**Files:**
- Modify: `src/lib/code.ts` (after `isValidSlug`, ~line 19)
- Test: `test/code.test.ts`

**Interfaces:**
- Consumes: existing `SLUG_RE` (`/^[a-z0-9][a-z0-9-]{0,62}$/`) from `src/lib/code.ts`.
- Produces: `export function isValidPath(path: string): boolean` — true iff every `/`-split segment matches `SLUG_RE`. (`isValidSlug` stays for now; removed in Task 6.)

- [ ] **Step 1: Write the failing test**

Add to `test/code.test.ts`. First extend the existing import line:

```ts
import { generateCode, isValidSlug, isValidPath, isValidCode, SLUG_RE } from "../src/lib/code.js";
```

Then add a new describe block (place it right after the `describe("isValidSlug", ...)` block):

```ts
describe("isValidPath", () => {
  it.each(["a", "report", "team/q1/report", "a/b", "aws-design", "a".repeat(63)])(
    "accepts %j",
    (p) => {
      expect(isValidPath(p)).toBe(true);
    },
  );
  it.each([
    "",
    "team//q1",
    "/team",
    "team/",
    "../etc",
    "team/..",
    ".",
    "team/_x",
    "_meta/x",
    "UpperCase",
    "has space",
    "team/" + "x".repeat(64),
  ])("rejects %j", (p) => {
    expect(isValidPath(p)).toBe(false);
  });
  it("exposes the regex", () => {
    expect(SLUG_RE.test("ok-slug")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/code.test.ts -t "isValidPath"`
Expected: FAIL — `isValidPath is not a function` (or import error).

- [ ] **Step 3: Write minimal implementation**

In `src/lib/code.ts`, add after the `isValidSlug` function (keep `isValidSlug` for now):

```ts
/** Multi-segment publish path: each "/"-separated segment must match SLUG_RE. */
export function isValidPath(path: string): boolean {
  return path.split("/").every((seg) => SLUG_RE.test(seg));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/code.test.ts`
Expected: PASS (all blocks, including the unchanged `isValidSlug` block).

- [ ] **Step 5: Commit**

```bash
git add src/lib/code.ts test/code.test.ts
git commit -m "feat: add isValidPath multi-segment validator (#7)"
```

---

### Task 2: Thread nested path through `publish`

**Files:**
- Modify: `src/commands/publish.ts:4` (import), `src/commands/publish.ts:52-57` (validation)
- Test: `test/publish.test.ts`

**Interfaces:**
- Consumes: `isValidPath` from `src/lib/code.js` (Task 1).
- Produces: `runPublish` accepts a `slug` containing `/`; uploads keyed `<slug>/<rel>`, sidecar `_meta/<slug>.json`, URL `<host>/<slug>/`, cloudfront invalidation `/<slug>/*`. (No signature change.)

- [ ] **Step 1: Write the failing tests**

Add these three tests inside `describe("runPublish", ...)` in `test/publish.test.ts`:

```ts
  it("uploads under a nested slug and returns the nested URL", async () => {
    writeFileSync(join(dir, "index.html"), "<title>Hi</title>");
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "a.css"), "body{}");

    const url = await runPublish({ path: dir, slug: "team/q1/report" });
    expect(url).toBe("http://b.s3-website-us-east-1.amazonaws.com/team/q1/report/");

    const puts = s3mock
      .commandCalls(PutObjectCommand)
      .map((c) => c.args[0].input.Key);
    expect(puts).toContain("team/q1/report/index.html");
    expect(puts).toContain("team/q1/report/assets/a.css");
    expect(puts).toContain("_meta/team/q1/report.json");
  });

  it("returns the nested URL and invalidates the nested prefix in cloudfront mode", async () => {
    process.env.HOSTDOC_DOMAIN = "shared.example.com";
    process.env.HOSTDOC_DISTRIBUTION = "DIST1";
    s3mock.on(ListObjectsV2Command).resolves({
      KeyCount: 1,
      Contents: [{ Key: "team/q1/report/index.html" }],
      IsTruncated: false,
    });
    writeFileSync(join(dir, "index.html"), "x");

    const url = await runPublish({ path: dir, slug: "team/q1/report", force: true });
    expect(url).toBe("https://shared.example.com/team/q1/report/");

    const calls = cfMock.commandCalls(CreateInvalidationCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.InvalidationBatch?.Paths?.Items).toEqual([
      "/team/q1/report/*",
    ]);

    delete process.env.HOSTDOC_DOMAIN;
    delete process.env.HOSTDOC_DISTRIBUTION;
  });

  it.each(["team/_x", "../etc", "a//b"])(
    "rejects an invalid nested slug %j and uploads nothing",
    async (slug) => {
      writeFileSync(join(dir, "index.html"), "x");
      await expect(runPublish({ path: dir, slug })).rejects.toThrow(/slug/i);
      expect(s3mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    },
  );
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/publish.test.ts -t "nested"`
Expected: FAIL — the nested-upload/invalidation tests throw `Invalid slug "team/q1/report"` (current `isValidSlug` rejects `/`).

- [ ] **Step 3: Write minimal implementation**

In `src/commands/publish.ts`, change the import on line 4:

```ts
import { generateCode, isValidPath } from "../lib/code.js";
```

Change the validation block (lines 52-57):

```ts
  if (args.slug) {
    if (!isValidPath(args.slug)) {
      throw new Error(
        `Invalid slug "${args.slug}". Use lowercase letters, digits, and hyphens per path segment (each segment must start alphanumeric); "/" separates nested segments.`,
      );
    }
```

(Leave the rest of the function unchanged — `existsPrefix`, overwrite delete, `metaKey`, `buildPublicUrl`, invalidation all already use `code`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/publish.test.ts`
Expected: PASS (new nested tests + all existing publish tests, including `"rejects an invalid slug"` which still rejects `"Bad Slug"`).

- [ ] **Step 5: Commit**

```bash
git add src/commands/publish.ts test/publish.test.ts
git commit -m "feat: support nested slug in publish (#7)"
```

---

### Task 3: Thread nested path through `rm`

**Files:**
- Modify: `src/commands/rm.ts:5` (import), `src/commands/rm.ts:11` (validation)
- Test: `test/rm.test.ts`

**Interfaces:**
- Consumes: `isValidPath`, `isValidCode` from `src/lib/code.js`.
- Produces: `runRm` accepts a nested `id`; deletes `<id>/*` + `_meta/<id>.json`, cloudfront invalidation `/<id>/*`.

- [ ] **Step 1: Write the failing tests + fix the now-stale rejection case**

In `test/rm.test.ts`, the existing rejection `it.each` lists `"x/y"`, which becomes **valid** under `isValidPath`. Change that line:

```ts
  it.each(["_meta", "../escape", "a b", "x//y", "x/_y", "x?y"])(
```

(`x//y` → empty segment rejected; `x/_y` → `_y` rejected; both stay invalid.)

Then add two positive nested tests inside `describe("runRm", ...)`:

```ts
  it("deletes a nested prefix plus its nested meta object", async () => {
    s3mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: "team/q1/report/index.html" },
        { Key: "team/q1/report/a.css" },
      ],
      IsTruncated: false,
    });
    s3mock.on(DeleteObjectsCommand).resolves({});

    await runRm({ id: "team/q1/report", yes: true });

    const deleted = s3mock
      .commandCalls(DeleteObjectsCommand)[0]
      .args[0].input.Delete?.Objects?.map((o) => o.Key);
    expect(deleted).toContain("team/q1/report/index.html");
    expect(deleted).toContain("_meta/team/q1/report.json");
  });

  it("invalidates the nested prefix in cloudfront mode", async () => {
    process.env.HOSTDOC_DOMAIN = "shared.example.com";
    process.env.HOSTDOC_DISTRIBUTION = "DIST1";
    s3mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: "team/q1/report/index.html" }],
      IsTruncated: false,
    });
    s3mock.on(DeleteObjectsCommand).resolves({});

    await runRm({ id: "team/q1/report", yes: true });

    const calls = cfMock.commandCalls(CreateInvalidationCommand);
    expect(calls[0].args[0].input.InvalidationBatch?.Paths?.Items).toEqual([
      "/team/q1/report/*",
    ]);

    delete process.env.HOSTDOC_DOMAIN;
    delete process.env.HOSTDOC_DISTRIBUTION;
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/rm.test.ts -t "nested"`
Expected: FAIL — nested delete throws `Invalid id: team/q1/report` (current `isValidSlug`/`isValidCode` reject `/`).

- [ ] **Step 3: Write minimal implementation**

In `src/commands/rm.ts`, change the import on line 5:

```ts
import { isValidPath, isValidCode } from "../lib/code.js";
```

Change the validation on line 11:

```ts
  if (!isValidPath(args.id) && !isValidCode(args.id)) {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/rm.test.ts`
Expected: PASS (nested tests + updated rejection list + all existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/commands/rm.ts test/rm.test.ts
git commit -m "feat: support nested id in rm (#7)"
```

---

### Task 4: Thread nested path through `open` + fix `openPublishedUrl`

**Files:**
- Modify: `src/commands/open.ts` (import + `resolveOpenUrl` validation + `openPublishedUrl` parsing)
- Test: `test/open.test.ts`, `test/publish-open.test.ts`

**Interfaces:**
- Consumes: `isValidPath`, `isValidCode` from `src/lib/code.js`.
- Produces: `resolveOpenUrl` accepts a nested `id`; `openPublishedUrl(url)` derives the full nested path from `new URL(url).pathname` (not just the last segment).

- [ ] **Step 1: Write the failing tests**

Add to `test/open.test.ts` inside `describe("resolveOpenUrl", ...)`:

```ts
  it("builds the URL for a nested path", () => {
    expect(resolveOpenUrl({ id: "team/q1/report" })).toBe(
      "http://b.s3-website-us-east-1.amazonaws.com/team/q1/report/",
    );
  });
```

Add to `test/publish-open.test.ts` inside `describe("openPublishedUrl", ...)`:

```ts
  it("derives a nested path from the published URL", () => {
    const url = openPublishedUrl(
      "http://envbkt.s3-website-us-east-1.amazonaws.com/team/q1/report/",
    );
    expect(url).toBe(
      "http://envbkt.s3-website-us-east-1.amazonaws.com/team/q1/report/",
    );
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/open.test.ts test/publish-open.test.ts -t "nested"`
Expected: FAIL — `resolveOpenUrl` throws `Invalid id: team/q1/report`; `openPublishedUrl` returns `.../report/` (old `slice(-2,-1)` extracts only the last segment).

- [ ] **Step 3: Write minimal implementation**

In `src/commands/open.ts`, change the import:

```ts
import { isValidPath, isValidCode } from "../lib/code.js";
```

In `resolveOpenUrl`, change the validation:

```ts
  if (!isValidPath(args.id) && !isValidCode(args.id)) {
    throw new Error(`Invalid id: ${args.id}`);
  }
```

Change `openPublishedUrl`:

```ts
/** Open a just-published URL: derive its (possibly nested) path and re-open under `overrides`. */
export function openPublishedUrl(url: string, overrides: Overrides = {}): string {
  const id = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
  return runOpen({ id, ...overrides });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/open.test.ts test/publish-open.test.ts`
Expected: PASS (nested tests + existing `/abc/` tests still derive `abc`).

- [ ] **Step 5: Commit**

```bash
git add src/commands/open.ts test/open.test.ts test/publish-open.test.ts
git commit -m "feat: support nested id in open; fix openPublishedUrl parsing (#7)"
```

---

### Task 5: Confirm CloudFront Function handles nested subdir index

**Files:**
- Test: `test/index-rewrite.test.ts` (no production change — `infra/index-rewrite.js` already handles this)

**Interfaces:**
- Consumes: the existing `handler` loaded from `infra/index-rewrite.js` and the `reqEvent` helper in the test file.
- Produces: nothing (verification-only task).

- [ ] **Step 1: Write the tests**

Add to `test/index-rewrite.test.ts` inside `describe("index-rewrite handler", ...)`:

```ts
  it("appends index.html for a nested trailing-slash URI", () => {
    const out = handler(reqEvent("/team/q1/report/"));
    expect(out.uri).toBe("/team/q1/report/index.html");
  });

  it("appends /index.html for a nested extensionless URI", () => {
    const out = handler(reqEvent("/team/q1/report"));
    expect(out.uri).toBe("/team/q1/report/index.html");
  });

  it("returns 403 for a nested underscore-prefixed meta path", () => {
    const out = handler(reqEvent("/_meta/team/q1/report.json"));
    expect(out.statusCode).toBe(403);
  });
```

- [ ] **Step 2: Run tests to verify they pass immediately**

Run: `npx vitest run test/index-rewrite.test.ts`
Expected: PASS — `infra/index-rewrite.js` already rewrites nested trailing-slash/extensionless URIs and 403s `/_*`. (If any FAIL, that is a real infra gap; fix `infra/index-rewrite.js` before committing.)

- [ ] **Step 3: Commit**

```bash
git add test/index-rewrite.test.ts
git commit -m "test: confirm CloudFront Function handles nested subdir index (#7)"
```

---

### Task 6: Remove orphaned `isValidSlug`; update CLI help + docs

**Files:**
- Modify: `src/lib/code.ts` (remove `isValidSlug`), `test/code.test.ts` (remove `isValidSlug` import + describe block)
- Modify: `src/index.ts:140` (--slug help text)
- Modify: `README.md` (add nested example near line 27)
- Modify: `docs/site/src/pages/GuidePage.jsx:137` (add nested example)

**Interfaces:**
- Consumes: nothing new. After Tasks 2–4, `isValidSlug` has no `src/` callers.
- Produces: `isValidSlug` removed from the public API of `src/lib/code.ts`.

- [ ] **Step 1: Verify `isValidSlug` is orphaned in src**

Run: `grep -rn "isValidSlug" src/`
Expected: no matches (all of publish/rm/open now use `isValidPath`). If any match remains, that consumer was missed — fix it before continuing.

- [ ] **Step 2: Remove `isValidSlug` from production + tests**

In `src/lib/code.ts`, delete the `isValidSlug` function (keep `SLUG_RE` and its comment):

```ts
export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}
```

In `test/code.test.ts`, remove `isValidSlug` from the import:

```ts
import { generateCode, isValidPath, isValidCode, SLUG_RE } from "../src/lib/code.js";
```

and delete the entire `describe("isValidSlug", () => { ... });` block (the `SLUG_RE` "exposes the regex" assertion already lives in the `isValidPath` block from Task 1).

- [ ] **Step 3: Update CLI help text**

In `src/index.ts`, change line 140:

```ts
  .option("--slug <path>", "custom path instead of a random code; '/' allowed for nested paths (e.g. team/q1/report)")
```

- [ ] **Step 4: Update README**

In `README.md`, replace the single slug example line (line 27) with two lines:

```bash
hostdoc publish ./site/ --slug aws-design
hostdoc publish ./site/ --slug team/q1/report   # nested path → .../team/q1/report/
```

- [ ] **Step 5: Update the guide site**

In `docs/site/src/pages/GuidePage.jsx`, add a sibling entry immediately after line 137 (same object shape):

```jsx
        { type: 'cmd', text: 'hostdoc publish ./site/ --slug aws-design' },
        { type: 'cmd', text: 'hostdoc publish ./site/ --slug team/q1/report' },
```

- [ ] **Step 6: Run the full suite + typecheck + build**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean (no dangling `isValidSlug` reference), all tests PASS, build emits `dist/`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/code.ts test/code.test.ts src/index.ts README.md docs/site/src/pages/GuidePage.jsx
git commit -m "refactor: drop orphaned isValidSlug; document nested paths (#7)"
```

---

## Self-Review

**Spec coverage:**
- Per-segment validation rejecting traversal/empty/`_`-leading → Task 1 (`isValidPath`) + tests.
- Thread nested prefix through publish (collision, overwrite, meta key, URL) → Task 2.
- Nested cloudfront invalidation `/team/q1/report/*` → Task 2 (publish) + Task 3 (rm).
- Confirm CloudFront Function handles nested subdir index → Task 5.
- `rm`/`open` accept nested ids (decided in brainstorming) → Tasks 3, 4.
- `openPublishedUrl` last-segment bug → Task 4.
- Tests: valid nested, rejected traversal/`_`/empty, both modes' URLs, invalidation path → Tasks 1–5.
- Docs: README + guide site → Task 6.
- Remove orphaned `isValidSlug` (created by this change) → Task 6.

**Placeholder scan:** No TBD/TODO; every code step shows exact code and exact commands.

**Type consistency:** `isValidPath(path: string): boolean` defined in Task 1 and consumed identically in Tasks 2–4. `openPublishedUrl(url, overrides)` signature unchanged. Meta key form `_meta/<slug>.json` asserted consistently across Tasks 2–3.

**Out-of-scope (documented in spec, not implemented):** `--force` on a parent prefix orphaning nested sidecars — pre-existing prefix-delete semantics, deferred to a possible follow-up issue.
