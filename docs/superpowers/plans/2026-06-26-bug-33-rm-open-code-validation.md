# rm/open Code Validation (#33) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `rm`/`open` accept the base62 (mixed-case) codes that `generateCode()` produces, so the ~98% of default codes containing an uppercase letter are no longer rejected as "Invalid id".

**Architecture:** Add a dedicated `isValidCode` validator to `src/lib/code.ts` (`/^[0-9A-Za-z]{1,63}$/`) and change the `rm`/`open` id gates from `!isValidSlug(id)` to `!isValidSlug(id) && !isValidCode(id)` (slug ∪ code). `isValidSlug`/`SLUG_RE`/`generateCode` are untouched — publish's slug validation must stay lowercase-only.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Commander, Vitest, `aws-sdk-client-mock`.

## Global Constraints

- ESM: relative imports in `.ts` need a `.js` extension (e.g. `../lib/code.js`).
- CI runs build→typecheck→test with **no AWS creds and no Terraform**; tests must not touch live AWS.
- Match existing style (`it.each` table tests, existing mock setup). No unrelated refactoring; do not touch `isValidSlug`/`SLUG_RE`/`generateCode`.
- Each task ends green on its test file; the full gate (`npm run build && npm run typecheck && npm test`) runs once at the end before push.
- Branch: `fix/33-rm-open-code-validation` (already created off `main`). Commit per task.

---

### Task 1: Add `isValidCode` to `src/lib/code.ts`

**Files:**
- Modify: `src/lib/code.ts` (add `CODE_RE` + `isValidCode` after `isValidSlug`)
- Test: `test/code.test.ts` (add import + `isValidCode` describe block)

**Interfaces:**
- Consumes: nothing new.
- Produces: `CODE_RE: RegExp` and `isValidCode(id: string): boolean` — true iff `id` is 1–63 base62 chars (`[0-9A-Za-z]`). Rejects empty, leading `_`, `/`, space, and anything > 63 chars.

- [ ] **Step 1: Write the failing test**

In `test/code.test.ts`, change the import on line 2 to add `isValidCode`:

```ts
import { generateCode, isValidSlug, isValidCode, SLUG_RE } from "../src/lib/code.js";
```

Then append a new describe block at the end of the file (after the `isValidSlug` block):

```ts
describe("isValidCode", () => {
  it.each(["spinIYr", "Abc123Z", "7charXX", "abc1234", "doc1", "a"])(
    "accepts base62 code %j",
    (s) => {
      expect(isValidCode(s)).toBe(true);
    },
  );
  it.each(["", "_meta", "a b", "a/b", "x#y", "../escape", "x".repeat(64)])(
    "rejects %j",
    (s) => {
      expect(isValidCode(s)).toBe(false);
    },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/code.test.ts`
Expected: FAIL — `isValidCode is not a function` (not yet exported).

- [ ] **Step 3: Write minimal implementation**

In `src/lib/code.ts`, add after the `isValidSlug` function (after line 19):

```ts
/** Generated codes: base62 (mixed case), 1–63 chars. No leading `_`, `/`, or space. */
export const CODE_RE = /^[0-9A-Za-z]{1,63}$/;

export function isValidCode(id: string): boolean {
  return CODE_RE.test(id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/code.test.ts`
Expected: PASS (all `isValidCode` cases plus the unchanged `generateCode`/`isValidSlug` cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/code.ts test/code.test.ts
git commit -m "feat: add isValidCode base62 validator for #33"
```

---

### Task 2: Accept codes in `rm`

**Files:**
- Modify: `src/commands/rm.ts:5` (import) and `src/commands/rm.ts:11` (gate)
- Test: `test/rm.test.ts` (drop `Doc1` from reject table; add uppercase-code accept case)

**Interfaces:**
- Consumes: `isValidCode(id: string): boolean` from `src/lib/code.ts` (Task 1); existing `isValidSlug`.
- Produces: nothing new (behavior change only).

- [ ] **Step 1: Write the failing test**

In `test/rm.test.ts`, edit the reject table (line 80) to remove `"Doc1"` — it is now a valid base62 code:

```ts
  it.each(["_meta", "../escape", "a b", "x/y", "x?y"])(
    "rejects invalid id %j before deleting anything",
```

Then add a new accept test inside `describe("runRm", ...)` (e.g. after the "deletes the prefix objects plus the meta object" test):

```ts
  it("accepts an uppercase-containing generated code", async () => {
    s3mock
      .on(ListObjectsV2Command)
      .resolves({ Contents: [{ Key: "spinIYr/index.html" }], IsTruncated: false });
    s3mock.on(DeleteObjectsCommand).resolves({});

    await runRm({ id: "spinIYr", yes: true });

    const deleted = s3mock
      .commandCalls(DeleteObjectsCommand)[0]
      .args[0].input.Delete?.Objects?.map((o) => o.Key);
    expect(deleted).toContain("spinIYr/index.html");
    expect(deleted).toContain("_meta/spinIYr.json");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/rm.test.ts`
Expected: FAIL — the new accept test throws `Invalid id: spinIYr` (uppercase `I` fails `isValidSlug` and `rm` does not yet consult `isValidCode`). The reject test passes (Doc1 removed).

- [ ] **Step 3: Write minimal implementation**

In `src/commands/rm.ts`, change the import on line 5:

```ts
import { isValidSlug, isValidCode } from "../lib/code.js";
```

Change the gate on lines 11–13:

```ts
  if (!isValidSlug(args.id) && !isValidCode(args.id)) {
    throw new Error(`Invalid id: ${args.id}`);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/rm.test.ts`
Expected: PASS — accept test deletes `spinIYr/...` + `_meta/spinIYr.json`; reject cases (`_meta`, `../escape`, `a b`, `x/y`, `x?y`) still throw before any AWS call.

- [ ] **Step 5: Commit**

```bash
git add src/commands/rm.ts test/rm.test.ts
git commit -m "fix: rm accepts base62 codes (slug ∪ code) for #33"
```

---

### Task 3: Accept codes in `open` + full gate

**Files:**
- Modify: `src/commands/open.ts:4` (import) and `src/commands/open.ts:9` (gate)
- Test: `test/open.test.ts` (drop `Doc1` from reject table; add uppercase-code accept case)

**Interfaces:**
- Consumes: `isValidCode(id: string): boolean` from `src/lib/code.ts` (Task 1); existing `isValidSlug`.
- Produces: nothing new (behavior change only).

- [ ] **Step 1: Write the failing test**

In `test/open.test.ts`, edit the reject table (line 52) to remove `"Doc1"`:

```ts
  it.each(["a b", "../escape", "x?y", "x#y", "_meta"])(
    "rejects invalid id %j",
```

Then add an accept test inside `describe("resolveOpenUrl", ...)` (after the "builds the URL for a code" test):

```ts
  it("accepts an uppercase-containing generated code", () => {
    expect(resolveOpenUrl({ id: "spinIYr" })).toBe(
      "http://b.s3-website-us-east-1.amazonaws.com/spinIYr/",
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/open.test.ts`
Expected: FAIL — the accept test throws `Invalid id: spinIYr` (uppercase `I` fails `isValidSlug`; `open` does not yet consult `isValidCode`).

- [ ] **Step 3: Write minimal implementation**

In `src/commands/open.ts`, change the import on line 4:

```ts
import { isValidSlug, isValidCode } from "../lib/code.js";
```

Change the gate on lines 9–11:

```ts
  if (!isValidSlug(args.id) && !isValidCode(args.id)) {
    throw new Error(`Invalid id: ${args.id}`);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/open.test.ts`
Expected: PASS — `resolveOpenUrl({ id: "spinIYr" })` returns the s3-website URL; reject cases still throw.

- [ ] **Step 5: Run the full gate**

Run: `npm run build && npm run typecheck && npm test`
Expected: build emits `dist/`, typecheck clean, all tests green (incl. `code`/`rm`/`open`).

- [ ] **Step 6: Commit**

```bash
git add src/commands/open.ts test/open.test.ts
git commit -m "fix: open accepts base62 codes (slug ∪ code) for #33"
```

---

## Self-Review

**Spec coverage:**
- `isValidCode` + unit tests → Task 1 ✓
- `rm` gate slug∪code → Task 2 ✓
- `open` gate slug∪code → Task 3 ✓
- `Doc1` reject→accept correction (rm/open tests) → Tasks 2 & 3 ✓
- `_meta`/reserved-prefix protection retained → covered (both `isValidSlug` and `isValidCode` reject leading `_`; reject tables keep `_meta`) ✓
- Acceptance: uppercase code rm/open works (Tasks 2/3 accept tests); slug path unchanged (untouched reject/accept tables + publish slug validation untouched); invalid ids still rejected (reject tables retained) ✓

**Placeholder scan:** No TBD/TODO; every code/test step shows full content.

**Type consistency:** `isValidCode(id: string): boolean` and `CODE_RE` are referenced identically across Tasks 1–3. Gate expression `!isValidSlug(args.id) && !isValidCode(args.id)` is identical in `rm.ts` and `open.ts`.
