# Spec: Make `publish --dry-run` AWS-free (offline URL preview)

- **Issue**: [#11](https://github.com/jkas2016/hostdoc/issues/11)
- **Date**: 2026-06-23
- **Follow-up to**: #5 / PR #10 (agent skill); see "Adjacent finding" in
  `docs/superpowers/specs/2026-06-23-hostdoc-skill-design.md`.

## Problem

`publish --dry-run` is documented as "show the URL without uploading", but it
still issues an AWS `ListObjectsV2` call before returning the URL
(`src/commands/publish.ts`):

- **No slug**: `uniqueCode()` probes `existsPrefix` to avoid code collisions.
- **With a slug**: the slug-collision check calls `existsPrefix`.

Both calls sit *before* the `if (args.dryRun) return …` short-circuit, so dry-run
requires valid credentials and network. An agent (or user) cannot preview a URL
offline / credential-free — which is exactly what the agent skill's AWS-free
preflight wants.

The published URL depends only on **config + code/slug**
(`buildPublicUrl(cfg, code)` in `src/lib/url.ts`); it is independent of the
uploaded file contents and of whether the prefix already exists. So the probes
are unnecessary for a preview.

## Goal

In dry-run, build and return the URL without any `existsPrefix` probe, so
`publish <path> --dry-run` (and `--slug x --dry-run`) works with no AWS
credentials configured and no network.

## Approach (decided)

**Keep local path validation; skip only the AWS calls.** Minimal, scope-faithful
change: dry-run still walks the local path (`collectUploads`) so a missing/empty
path errors early even in a preview, and `makeS3()` (which creates a client but
never calls `.send()`) stays in place. Only the two `existsPrefix` probes are
gated behind `!args.dryRun`.

Rejected alternative — *pure URL preview* (early-return right after config +
slug validation, skipping the filesystem walk and `makeS3`): cleaner code, but a
typo'd path would pass dry-run silently and only fail on the real publish. Worse
UX for no real gain, and a larger diff than the issue's scope calls for.

## Changes

### 1. `src/commands/publish.ts`

Structure unchanged. Gate the two AWS calls on `!args.dryRun`:

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

- Slug **validity** is still enforced in dry-run (a structurally invalid slug is
  rejected for a preview too); only the **collision** probe is skipped.
- No-slug dry-run uses `generateCode()` directly (dry-run writes nothing, so a
  theoretical collision is irrelevant to a preview).
- `generateCode` is already imported; no new imports.
- The non-dry-run code path is byte-for-byte unchanged → existing behavior and
  tests preserved.

### 2. `test/publish.test.ts`

Strengthen the existing `dry-run uploads nothing` test and add coverage so the
dry-run path asserts **zero** AWS calls for both slug and no-slug:

- **Slug dry-run**: `runPublish({ path, slug: "doc1", dryRun: true })` returns
  `http://b.s3-website-us-east-1.amazonaws.com/doc1/`, with
  `s3mock.commandCalls(ListObjectsV2Command).length === 0` **and**
  `commandCalls(PutObjectCommand).length === 0`.
- **No-slug dry-run**: `runPublish({ path, dryRun: true })` returns a URL
  matching `/^http:\/\/b\.s3-website-us-east-1\.amazonaws\.com\/[0-9a-zA-Z]{7}\/$/`,
  with the same zero `ListObjectsV2` / `PutObject` assertions.

Zero `ListObjectsV2` calls (no mock `.send()`) is the evidence that the path
needs neither credentials nor network. Existing non-dry-run tests are unchanged.

### 3. Docs

- `skills/hostdoc/references/commands.md`: remove the caveat note (the
  "`publish --dry-run` currently still makes an AWS call…" block).
- `README.md`: add one line near the `publish` examples noting that `--dry-run`
  previews the URL offline (no AWS credentials / network). README currently has
  no `--dry-run` mention; keep the addition minimal.

## Non-goals

- No change to non-dry-run `publish` behavior (collision checks, `--force`,
  uploads, meta sidecar, CloudFront invalidation).
- No change to the agent skill code itself (it already documents the caveat and
  can adopt dry-run previews once this lands).

## Acceptance criteria

- `publish <path> --dry-run` and `--slug x --dry-run` return a correct URL with
  no AWS credentials configured and no network.
- Tests assert the dry-run path issues no S3 calls (slug and no-slug).
- Non-dry-run publish behavior is unchanged (existing tests still pass).

## Risks

- Dry-run no longer warns that a slug already exists. **Mitigation**: acceptable
  for a preview; the real publish still enforces the collision check / `--force`.
  Documented as an intentional behavior change.
```
