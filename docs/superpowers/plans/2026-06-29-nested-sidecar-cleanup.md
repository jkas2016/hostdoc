# Nested Sidecar Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rm`/`publish --force` deletes a prefix's content recursively but only removes the top-level `_meta/<code>.json` sidecar; make it also delete nested children's `_meta/<code>/**` sidecars so they don't linger as stale 404 rows in `list`.

**Architecture:** Add one helper `nestedMetaPrefix(code)` next to `metaKey` in `src/lib/meta.ts` (single source of sidecar-key derivation). In `rm.ts` and the `publish.ts --force` block, enumerate `_meta/<code>/` via `listKeys` and fold those keys into the existing `deleteKeys` call — making sidecar lifecycle symmetric with content-prefix delete.

**Tech Stack:** TypeScript (ESM, `.js` import extensions in `.ts` source), Vitest + `aws-sdk-client-mock`, AWS SDK v3 (`@aws-sdk/client-s3`).

## Global Constraints

- ESM: relative imports MUST use a `.js` extension in `.ts` source (e.g. `../lib/meta.js`).
- Tests use `aws-sdk-client-mock`; mock S3 by `ListObjectsV2Command` **scoped by `Prefix`** when a command issues more than one list call.
- No AWS creds / no Terraform in CI; all AWS is mocked.
- Sidecar key rule lives only in `src/lib/meta.ts` — do not inline `_meta/...` string literals in command files.
- Run a single test file: `npx vitest run test/<file>.test.ts`. Run one test: `npx vitest run -t "<name>"`. Full suite: `npm test`. Type-check: `npm run typecheck`.

---

### Task 1: `nestedMetaPrefix` helper

**Files:**
- Modify: `src/lib/meta.ts` (add export next to `metaKey`, `src/lib/meta.ts:13-15`)
- Test: `test/meta.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `nestedMetaPrefix(code: string): string` — returns `` `_meta/${code}/` ``. Consumed by Tasks 2 and 3.

- [ ] **Step 1: Write the failing tests**

Add to `test/meta.test.ts` (import `nestedMetaPrefix` alongside the existing `meta.js` imports):

```ts
import { nestedMetaPrefix } from "../src/lib/meta.js";

describe("nestedMetaPrefix", () => {
  it("returns the sidecar prefix for a top-level code", () => {
    expect(nestedMetaPrefix("team")).toBe("_meta/team/");
  });

  it("returns the sidecar prefix for a nested code", () => {
    expect(nestedMetaPrefix("team/q1/report")).toBe("_meta/team/q1/report/");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/meta.test.ts -t "nestedMetaPrefix"`
Expected: FAIL — `nestedMetaPrefix is not a function` (or import/type error).

- [ ] **Step 3: Write minimal implementation**

In `src/lib/meta.ts`, directly below `metaKey`:

```ts
export function nestedMetaPrefix(code: string): string {
  return `_meta/${code}/`; // code 아래 사는 모든 문서의 사이드카 prefix
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/meta.test.ts -t "nestedMetaPrefix"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/meta.ts test/meta.test.ts
git commit -m "feat: nestedMetaPrefix(code) helper for sidecar-tree enumeration (#37)"
```

---

### Task 2: `rm` deletes nested sidecars

**Files:**
- Modify: `src/commands/rm.ts` (`src/commands/rm.ts:23-35`)
- Test: `test/rm.test.ts`

**Interfaces:**
- Consumes: `nestedMetaPrefix` from Task 1; existing `listKeys`, `deleteKeys` (`src/lib/aws.ts`), `metaKey` (`src/lib/meta.ts`).
- Produces: nothing new (behavior change only).

Note on test mocking: after this change `runRm` issues **two** `ListObjectsV2Command` calls (content `` `${id}/` `` then sidecars `` `_meta/${id}/` ``). Existing tests use a single generic `s3mock.on(ListObjectsV2Command).resolves(...)` which would answer **both** calls with content keys. New/updated tests MUST scope by `Prefix` so the second call returns the sidecar set, e.g. `s3mock.on(ListObjectsV2Command, { Prefix: "_meta/team/" }).resolves(...)`. The legacy generic mock stays as a fallback for the content call; scope only what a test asserts on.

- [ ] **Step 1: Write the failing test**

Add to `test/rm.test.ts`, inside `describe("runRm", ...)`:

```ts
it("deletes nested child sidecars under the parent prefix", async () => {
  s3mock
    .on(ListObjectsV2Command, { Prefix: "team/" })
    .resolves({ Contents: [{ Key: "team/index.html" }], IsTruncated: false });
  s3mock
    .on(ListObjectsV2Command, { Prefix: "_meta/team/" })
    .resolves({ Contents: [{ Key: "_meta/team/q1/report.json" }], IsTruncated: false });
  s3mock.on(DeleteObjectsCommand).resolves({});

  await runRm({ id: "team", yes: true });

  const deleted = s3mock
    .commandCalls(DeleteObjectsCommand)[0]
    .args[0].input.Delete?.Objects?.map((o) => o.Key);
  expect(deleted).toContain("team/index.html");
  expect(deleted).toContain("_meta/team.json");
  expect(deleted).toContain("_meta/team/q1/report.json");
});

it("deletes only the own sidecar when there are no nested children", async () => {
  s3mock
    .on(ListObjectsV2Command, { Prefix: "doc1/" })
    .resolves({ Contents: [{ Key: "doc1/index.html" }], IsTruncated: false });
  s3mock
    .on(ListObjectsV2Command, { Prefix: "_meta/doc1/" })
    .resolves({ Contents: [], IsTruncated: false });
  s3mock.on(DeleteObjectsCommand).resolves({});

  await runRm({ id: "doc1", yes: true });

  const deleted = s3mock
    .commandCalls(DeleteObjectsCommand)[0]
    .args[0].input.Delete?.Objects?.map((o) => o.Key);
  expect(deleted).toContain("doc1/index.html");
  expect(deleted).toContain("_meta/doc1.json");
  expect(deleted).not.toContain("_meta/team/q1/report.json");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/rm.test.ts -t "nested child sidecars"`
Expected: FAIL — `deleted` lacks `_meta/team/q1/report.json` (only content + `_meta/team.json` deleted today).

- [ ] **Step 3: Write minimal implementation**

In `src/commands/rm.ts`, import the helper and enumerate nested sidecars. Change the imports line:

```ts
import { metaKey, nestedMetaPrefix } from "../lib/meta.js";
```

Replace the body from the content `listKeys` through `deleteKeys` (`src/commands/rm.ts:23-35`):

```ts
  const keys = await listKeys(s3, cfg.bucket, `${args.id}/`);
  if (keys.length === 0) {
    throw new Error(`Document not found: ${args.id}`);
  }

  if (!args.yes) {
    const ok = await confirm(
      `Delete "${args.id}" (${keys.length} file(s))? [y/N] `,
    );
    if (!ok) throw new Error("Aborted.");
  }

  const nestedMeta = await listKeys(s3, cfg.bucket, nestedMetaPrefix(args.id));
  await deleteKeys(s3, cfg.bucket, [...keys, metaKey(args.id), ...nestedMeta]);
```

(Not-found check and the confirm prompt's file count stay keyed on `keys` — content only; sidecars are internal objects the user never sees.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/rm.test.ts`
Expected: PASS — new tests pass; all pre-existing `runRm` tests still pass (their generic content mock answers the `` `${id}/` `` call; the extra `_meta/<id>/` call returns the same content keys harmlessly, and assertions use `toContain`).

- [ ] **Step 5: Commit**

```bash
git add src/commands/rm.ts test/rm.test.ts
git commit -m "fix: rm deletes nested child _meta sidecars under the prefix (#37)"
```

---

### Task 3: `publish --force` deletes nested sidecars

**Files:**
- Modify: `src/commands/publish.ts` (`src/commands/publish.ts:73-80`)
- Test: `test/publish.test.ts`

**Interfaces:**
- Consumes: `nestedMetaPrefix` from Task 1; existing `listKeys`, `deleteKeys`, `putObject` (`src/lib/aws.ts`), `metaKey` (`src/lib/meta.ts`).
- Produces: nothing new (behavior change only).

Note: the own sidecar `_meta/<code>.json` is deliberately NOT deleted here — it is rewritten by the `putObject(metaKey(code), ...)` call later in `runPublish` (`src/commands/publish.ts:100-106`). Only nested children's sidecars need removal. The `--force` block issues a second `ListObjectsV2Command` with `Prefix: "_meta/<code>/"`; scope test mocks accordingly.

- [ ] **Step 1: Add the `DeleteObjectsCommand` import, then write the failing test**

`test/publish.test.ts` already imports `S3Client`, `PutObjectCommand`, `ListObjectsV2Command` from `@aws-sdk/client-s3` and `runPublish` from `../src/commands/publish.js`. It does NOT import `DeleteObjectsCommand` — add it to that import list:

```ts
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
```

The file's `beforeEach` creates a fresh temp `dir`, sets a generic `s3mock.on(ListObjectsV2Command).resolves({ KeyCount: 0, Contents: [] })`, mocks `PutObjectCommand`, and sets `HOSTDOC_BUCKET`/`HOSTDOC_REGION`. Tests write their own content into `dir` and call `runPublish({ path: dir, ... })`. Follow that pattern — add inside `describe("runPublish", ...)`:

```ts
it("force-overwrite deletes nested child sidecars and rewrites its own", async () => {
  writeFileSync(join(dir, "index.html"), "<title>Hi</title>");
  s3mock
    .on(ListObjectsV2Command, { Prefix: "team/" })
    .resolves({ KeyCount: 1, Contents: [{ Key: "team/index.html" }], IsTruncated: false });
  s3mock
    .on(ListObjectsV2Command, { Prefix: "_meta/team/" })
    .resolves({ Contents: [{ Key: "_meta/team/q1/report.json" }], IsTruncated: false });
  s3mock.on(DeleteObjectsCommand).resolves({});

  await runPublish({ path: dir, slug: "team", force: true });

  const deleted = s3mock
    .commandCalls(DeleteObjectsCommand)
    .flatMap((c) => c.args[0].input.Delete?.Objects?.map((o) => o.Key) ?? []);
  expect(deleted).toContain("team/index.html");
  expect(deleted).toContain("_meta/team/q1/report.json");
  expect(deleted).not.toContain("_meta/team.json"); // own sidecar is rewritten, not deleted

  const putKeys = s3mock
    .commandCalls(PutObjectCommand)
    .map((c) => c.args[0].input.Key);
  expect(putKeys).toContain("_meta/team.json");
});

it("force-overwrite with no nested children deletes no extra sidecars", async () => {
  writeFileSync(join(dir, "index.html"), "<title>Hi</title>");
  s3mock
    .on(ListObjectsV2Command, { Prefix: "team/" })
    .resolves({ KeyCount: 1, Contents: [{ Key: "team/index.html" }], IsTruncated: false });
  s3mock
    .on(ListObjectsV2Command, { Prefix: "_meta/team/" })
    .resolves({ Contents: [], IsTruncated: false });
  s3mock.on(DeleteObjectsCommand).resolves({});

  await runPublish({ path: dir, slug: "team", force: true });

  const deleted = s3mock
    .commandCalls(DeleteObjectsCommand)
    .flatMap((c) => c.args[0].input.Delete?.Objects?.map((o) => o.Key) ?? []);
  expect(deleted).toEqual(["team/index.html"]);
});
```

(`writeFileSync` and `join` are already imported at the top of `test/publish.test.ts`. The `KeyCount: 1` on the content mock mirrors how `existsPrefix` reads `res.KeyCount`; with `force: true` the "already exists" guard is skipped regardless.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/publish.test.ts -t "nested child sidecars"`
Expected: FAIL — `deleted` lacks `_meta/team/q1/report.json` (force block deletes content only today).

- [ ] **Step 3: Write minimal implementation**

In `src/commands/publish.ts`, import the helper (extend the existing `meta.js` import on `src/commands/publish.ts:6`):

```ts
import { buildMeta, metaKey, nestedMetaPrefix, extractTitle } from "../lib/meta.js";
```

Replace the `--force` block (`src/commands/publish.ts:73-80`):

```ts
  let overwritten = false;
  if (args.force) {
    const existing = await listKeys(s3, cfg.bucket, `${code}/`);
    if (existing.length) {
      const nestedMeta = await listKeys(s3, cfg.bucket, nestedMetaPrefix(code));
      await deleteKeys(s3, cfg.bucket, [...existing, ...nestedMeta]);
      overwritten = true;
    }
  }
```

(The own sidecar `_meta/<code>.json` is untouched — rewritten by the existing `putObject(metaKey(code), ...)` below. `nestedMeta` non-empty implies content under `code/` exists, so it is safely inside the `if (existing.length)` guard.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/publish.test.ts`
Expected: PASS — new tests pass; pre-existing publish tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/commands/publish.ts test/publish.test.ts
git commit -m "fix: publish --force deletes nested child _meta sidecars (#37)"
```

---

### Task 4: Update #7 spec Risks row + full verification

**Files:**
- Modify: `docs/superpowers/specs/2026-06-29-nested-custom-paths-design.md` (Risks table, last row)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (docs only).

- [ ] **Step 1: Update the Risks table last row**

In `docs/superpowers/specs/2026-06-29-nested-custom-paths-design.md`, change the last Risks row's mitigation cell from the "(범위 밖) ... 문서화만; 필요 시 후속 이슈" wording to reference the resolution. Replace the mitigation cell text with:

```
기존 prefix-delete 시맨틱. **#37에서 해결** — prefix 삭제/덮어쓰기 시 `_meta/<prefix>/**` 중첩 사이드카도 함께 삭제 (spec: `2026-06-29-nested-sidecar-cleanup-design.md`).
```

(Keep the risk description cell unchanged; only update the mitigation cell.)

- [ ] **Step 2: Run the full verification suite**

Run: `npm run build && npm run typecheck && npm test`
Expected: build emits `dist/` with no errors; `tsgo --noEmit` reports no type errors; **all** Vitest tests pass (new + pre-existing). If any pre-existing test fails because it now receives a second `ListObjectsV2Command` call, scope that test's mock by `Prefix` (content vs `_meta/<code>/`) per the Global Constraints — do not weaken assertions.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-29-nested-custom-paths-design.md
git commit -m "docs: mark #7 nested-sidecar-orphan risk resolved by #37"
```

---

## Self-Review

**1. Spec coverage** (against `2026-06-29-nested-sidecar-cleanup-design.md`):
- D1 `nestedMetaPrefix` helper → Task 1 ✓
- D2 `rm` nested sidecar deletion → Task 2 ✓
- D3 `publish --force` nested sidecar deletion → Task 3 ✓
- D4 CloudFront no-change → no task needed (explicitly nothing to do; rm/publish invalidation lines untouched) ✓
- Test plan (meta/rm/publish) → Tasks 1–3 each carry their tests ✓
- "기존 테스트 조정" (Prefix-scoped mocking) → covered in Task 2/3 notes + Task 4 Step 2 fallback ✓
- Docs: #7 Risks row update → Task 4 ✓
- Edge cases (sibling `teamfoo`, leaf, nested `team/q1`, dry-run): sibling+leaf asserted in Task 2/3 tests; nested-code prefix correctness guaranteed by `nestedMetaPrefix` unit test (Task 1) + helper definition; dry-run path returns before the delete blocks (unchanged) ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; test bodies are concrete. Task 3 Step 1 instructs reusing the real fixture/import names from `test/publish.test.ts` rather than inventing them — concrete instruction, not a placeholder. ✓

**3. Type consistency:** `nestedMetaPrefix(code: string): string` defined in Task 1 and called identically in Tasks 2–3. `metaKey` / `listKeys` / `deleteKeys` / `putObject` signatures match `src/lib/meta.ts` and `src/lib/aws.ts` as read. ✓
