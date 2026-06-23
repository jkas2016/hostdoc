# AWS-free `publish --dry-run` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `publish --dry-run` (with and without `--slug`) build and return the public URL without issuing any AWS call, so an unconfigured/credential-free/offline URL preview works.

**Architecture:** In `runPublish` (`src/commands/publish.ts`), gate the two `existsPrefix` (`ListObjectsV2`) probes behind `!args.dryRun`: the slug-collision check is skipped in dry-run, and the no-slug branch generates a code locally via `generateCode()` instead of the `uniqueCode()` uniqueness probe. The function's structure, the local path walk (`collectUploads`), and the entire non-dry-run code path are unchanged.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Vitest, `aws-sdk-client-mock`.

## Global Constraints

- ESM source: relative imports MUST use a `.js` extension (e.g. `../lib/code.js`).
- CI runs build→typecheck→test with **no AWS creds and no Terraform**; the dry-run path must make zero AWS `.send()` calls.
- Tests use `aws-sdk-client-mock`; state is set via `HOSTDOC_*` env vars (see `test/publish.test.ts` `beforeEach`/`afterEach`).
- Minimal change: the non-dry-run code path in `runPublish` must remain byte-for-byte unchanged. Do not touch collision checks, `--force`, uploads, meta sidecar, or CloudFront invalidation.
- `generateCode()` (default length 7, base62) and `isValidSlug()` live in `src/lib/code.js` and are already imported by `publish.ts`.

---

### Task 1: Skip AWS probes in `runPublish` when `dryRun` is set

**Files:**
- Modify: `src/commands/publish.ts:48-66` (the `let code` block through the `if (args.dryRun)` return)
- Test: `test/publish.test.ts`

**Interfaces:**
- Consumes: `runPublish(args: PublishArgs): Promise<string>` (existing); `args.dryRun?: boolean`, `args.slug?: string`, `args.force?: boolean`. `generateCode(len?: number): string`, `isValidSlug(slug: string): boolean`, `existsPrefix(s3, bucket, prefix): Promise<boolean>`, `buildPublicUrl(cfg, code): string` (all existing).
- Produces: no new exported symbols. Behavior change only: when `args.dryRun` is true, `runPublish` issues zero AWS calls and returns `buildPublicUrl(cfg, code)`.

- [ ] **Step 1: Write the failing tests**

In `test/publish.test.ts`, the file already imports `ListObjectsV2Command` and `PutObjectCommand` from `@aws-sdk/client-s3`. Replace the existing `it("dry-run uploads nothing", …)` test (currently around lines 64–68) with these three tests:

```ts
  it("dry-run with a slug returns the URL and makes zero AWS calls", async () => {
    writeFileSync(join(dir, "index.html"), "x");
    const url = await runPublish({ path: dir, slug: "doc1", dryRun: true });
    expect(url).toBe("http://b.s3-website-us-east-1.amazonaws.com/doc1/");
    expect(s3mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);
    expect(s3mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it("dry-run without a slug returns a well-formed URL and makes zero AWS calls", async () => {
    writeFileSync(join(dir, "index.html"), "x");
    const url = await runPublish({ path: dir, dryRun: true });
    expect(url).toMatch(
      /^http:\/\/b\.s3-website-us-east-1\.amazonaws\.com\/[0-9a-zA-Z]{7}\/$/,
    );
    expect(s3mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);
    expect(s3mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it("dry-run still rejects a structurally invalid slug", async () => {
    writeFileSync(join(dir, "index.html"), "x");
    await expect(
      runPublish({ path: dir, slug: "Bad Slug", dryRun: true }),
    ).rejects.toThrow(/slug/i);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/publish.test.ts -t "dry-run"`
Expected: The two "zero AWS calls" tests FAIL — currently the slug dry-run calls `existsPrefix` (`ListObjectsV2`), so `commandCalls(ListObjectsV2Command)` has length 1, not 0. (The "invalid slug" test already passes; that's fine.)

- [ ] **Step 3: Gate the AWS probes behind `!args.dryRun`**

In `src/commands/publish.ts`, replace the block (currently lines 48–66):

```ts
  let code: string;
  if (args.slug) {
    if (!isValidSlug(args.slug)) {
      throw new Error(
        `Invalid slug "${args.slug}". Use lowercase letters, digits, and hyphens (must start alphanumeric).`,
      );
    }
    const exists = await existsPrefix(s3, cfg.bucket, `${args.slug}/`);
    if (exists && !args.force) {
      throw new Error(`Slug "${args.slug}" already exists. Use --force to overwrite.`);
    }
    code = args.slug;
  } else {
    code = await uniqueCode(s3, cfg.bucket);
  }

  if (args.dryRun) {
    return buildPublicUrl(cfg, code);
  }
```

with (the only changes: the `if (!args.dryRun)` guard around the slug-collision probe, and the `args.dryRun ? generateCode() : …` ternary in the no-slug branch):

```ts
  let code: string;
  if (args.slug) {
    if (!isValidSlug(args.slug)) {
      throw new Error(
        `Invalid slug "${args.slug}". Use lowercase letters, digits, and hyphens (must start alphanumeric).`,
      );
    }
    if (!args.dryRun) {
      const exists = await existsPrefix(s3, cfg.bucket, `${args.slug}/`);
      if (exists && !args.force) {
        throw new Error(`Slug "${args.slug}" already exists. Use --force to overwrite.`);
      }
    }
    code = args.slug;
  } else {
    code = args.dryRun ? generateCode() : await uniqueCode(s3, cfg.bucket);
  }

  if (args.dryRun) {
    return buildPublicUrl(cfg, code);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/publish.test.ts`
Expected: PASS — all `publish.test.ts` tests, including the three dry-run tests and the unchanged non-dry-run tests (`uploads a folder…`, `rejects an invalid slug`, `refuses to overwrite…`, the two CloudFront tests).

- [ ] **Step 5: Typecheck and full test suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean (`uniqueCode` is still used in the no-slug non-dry-run branch, so no "unused" error); entire suite green.

- [ ] **Step 6: Commit**

```bash
git add src/commands/publish.ts test/publish.test.ts
git commit -m "feat: make publish --dry-run AWS-free (#11)

Skip the existsPrefix probes in dry-run: gate the slug-collision check
behind !dryRun and generate the no-slug code locally. URL preview now
needs no credentials or network. Non-dry-run path unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Update docs — remove the skill caveat and add a README note

**Files:**
- Modify: `skills/hostdoc/references/commands.md` (remove the "currently still makes an AWS call" caveat block)
- Modify: `README.md` (add a one-line `--dry-run` offline-preview note near the `publish` examples)

**Interfaces:**
- Consumes: nothing (docs only).
- Produces: nothing (docs only).

- [ ] **Step 1: Remove the caveat note in `skills/hostdoc/references/commands.md`**

Delete this block (currently the last lines of the file):

```markdown
> Note: `publish --dry-run` currently still makes an AWS call to check slug/code
> availability, so it needs valid credentials. (Tracked as a separate CLI
> follow-up to make dry-run fully offline.)
```

Also remove the single blank line that separated it from the preceding bullet list, so the file ends cleanly on the `provision is long-running…` bullet. Verify with:

Run: `grep -n "dry-run\|AWS call" skills/hostdoc/references/commands.md`
Expected: only the flags-table row at line ~18 (`… --dry-run` in the `publish` row) remains; the caveat block is gone.

- [ ] **Step 2: Add a `--dry-run` note to `README.md`**

In `README.md`, immediately after the `publish` example block (the lines around 22–23 that show `hostdoc publish ./report.html` and `hostdoc publish ./site/ --slug aws-design`), add one line:

```markdown
`--dry-run` prints the URL it *would* publish to without uploading — and without any AWS call, so it works offline / with no credentials configured.
```

Run: `grep -n "dry-run" README.md`
Expected: the new line is present.

- [ ] **Step 3: Confirm tests still pass (docs-only, sanity)**

Run: `npm test`
Expected: PASS (unchanged from Task 1; docs don't affect tests).

- [ ] **Step 4: Commit**

```bash
git add README.md skills/hostdoc/references/commands.md
git commit -m "docs: document AWS-free publish --dry-run, drop the caveat (#11)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage** (against `docs/superpowers/specs/2026-06-23-publish-dry-run-aws-free-design.md`):
- "In dry-run, do not call AWS / build URL without `existsPrefix`" → Task 1, Step 3 (both branches gated).
- "No slug: generate a code locally without the uniqueness probe" → Task 1, Step 3 (`args.dryRun ? generateCode() : …`).
- "With a slug: skip the collision check in dry-run" → Task 1, Step 3 (`if (!args.dryRun)` guard).
- "Slug validity still enforced in dry-run" → Task 1, Step 1 (third test) + Step 3 (validity check is outside the `!args.dryRun` guard).
- "Tests assert zero AWS calls for slug and no-slug" → Task 1, Step 1 (first two tests).
- "Non-dry-run behavior unchanged" → Task 1, Step 5 (full suite green); the non-dry-run lines are untouched.
- "Remove caveat in `commands.md`; update README" → Task 2, Steps 1–2.
- Acceptance: "no credentials, no network" → Task 1, Step 1 (zero `ListObjectsV2`/`PutObject` `.send()` calls).
- All spec sections map to a task. No gaps.

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"write tests for the above". Every code step shows full code; every command shows expected output. Clean.

**3. Type consistency:** `runPublish`, `PublishArgs`, `generateCode`, `isValidSlug`, `existsPrefix`, `uniqueCode`, `buildPublicUrl` are used with their existing signatures (verified against `src/commands/publish.ts`, `src/lib/code.ts`, `src/lib/url.ts`). The mock command classes `ListObjectsV2Command`/`PutObjectCommand` are already imported in `test/publish.test.ts`. Consistent.
