# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`hostdoc` is a public CLI that publishes a local HTML file/folder to the **user's own AWS** and returns a short link. Users run it on their own machine; the repo's CI never touches live AWS.

## Commands
- `npm run build` — `tsc`, emits `dist/` (the published artifact).
- `npm run typecheck` — `tsgo --noEmit` (type-check only; tsgo can't emit, so `build` stays on `tsc`).
- `npm test` · `npx vitest run test/x.test.ts` · `npx vitest run -t "name"` — tests (AWS mocked).
- `npm run dev` — run the CLI from source without building.
- CI runs build→typecheck→test with **no AWS creds and no Terraform**; keep it that way.

## Architecture
- **Two hosting modes, one code path.** Upload (file/folder → `<code>/` prefix, Content-Type, `_meta/<code>.json` sidecar) is mode-common; only the URL builder, CloudFront invalidation, and provisioning differ. Mode is *derived* in `resolveConfig()` (`src/lib/config.ts`), never stored: `domain`+`distributionId` → `cloudfront` (private S3+OAC+CloudFront, HTTPS, Terraform-provisioned); else `bucket`+`region` → `s3-website` (public bucket, HTTP, CLI `setup`).
- **Config precedence**: CLI flags > `HOSTDOC_*` env > `~/.config/hostdoc/config.json` — so a user can point it at bring-your-own infra.
- **Layers**: `src/index.ts` (Commander) → `src/commands/*` (one per subcommand) → `src/lib/*` (AWS, terraform shell-out, config, walk/mime/meta, code, url, browser).
- **Agent skill**: `skills/hostdoc/` (repo-root, Vercel skills layout — not `.claude/skills/`) wraps the CLI via `scripts/run.mjs` (PATH→`npx` fallback) + `scripts/preflight.mjs`. It shells out only; not bundled into npm `files`. Distributed via `npx skills add jkas2016/hostdoc`.
- **`_meta/` is protected two ways**: s3-website via a bucket-policy Deny; cloudfront via `infra/index-rewrite.js` (403 on `/_*`). That same function also appends `index.html` to trailing-slash/extensionless URIs (CloudFront Default Root Object applies only to `/`).
- **Invalidation is cloudfront-only** (`/<code>/*` on `publish --force` and `rm`, backoff on throttle); the CloudFront client is always `us-east-1`.
- **`infra/` Terraform runs only locally**, via `src/lib/terraform.ts`: `provision` (init+apply), `deprovision` (destroy), `init --from-terraform` (import outputs without applying).

## Gotchas
- ESM: relative imports need a `.js` extension in `.ts` source (`./commands/setup.js`).
- Tests use `aws-sdk-client-mock`; `test/setup-env.ts` repoints `XDG_CONFIG_HOME` to a temp dir, and tests set state via `HOSTDOC_*` env vars.
- Decisions + rationale (with official AWS doc links) live in `docs/superpowers/{specs,plans}/`; read before changing mode/provisioning/invalidation behavior.
