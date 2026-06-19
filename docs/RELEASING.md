# Releasing hostdoc

Releases are automated with [semantic-release](https://semantic-release.gitbook.io/)
and published to npm via **OIDC trusted publishing** — there is no stored npm token.

## One-time bootstrap (first release only)

Trusted publishing is configured per npm package, and `hostdoc` does not exist on
npm yet. So the very first publish is manual, after which all releases are automated.

1. **Claim the package name with one manual publish** from your machine:
   ```bash
   npm login            # interactive
   npm run build        # emits dist/
   npm publish          # publishes the current package.json version
   ```
   (Alternatively use a short-lived npm automation token for this single publish.)
2. On **npmjs.com → the `hostdoc` package → Settings → Trusted Publishers**, add a
   GitHub Actions publisher: this repository + workflow file `release.yml`
   (+ environment if you use one). Save.
3. From now on, never publish manually — use the workflow below.

> If npm lets you register the trusted publisher before the first publish, you may
> skip the manual `npm publish` and run the workflow for 1.0.0 directly. Confirm the
> current flow in the npm docs: https://docs.npmjs.com/trusted-publishers/

## Cutting a release

1. Make sure the commits you want released are merged to `main` and follow
   Conventional Commits (`feat:` → minor, `fix:` → patch, `feat!:`/`BREAKING CHANGE:` → major).
2. **Dry run first** (recommended): GitHub → Actions → **Release** → *Run workflow* →
   `dry_run = true`. Read the log: it prints the next version and release notes,
   publishes nothing.
3. **Real release**: *Run workflow* with `dry_run = false`. semantic-release bumps
   the version, updates `CHANGELOG.md`, publishes to npm (with provenance), creates
   the GitHub Release, and commits `CHANGELOG.md`/`package.json` back to `main` with
   `[skip ci]`.

## Requirements (already encoded in the workflow)

- GitHub-hosted runner, Node ≥ 22.14, npm ≥ 11.5.1 (the workflow upgrades npm).
- Workflow permissions: `id-token: write` (npm OIDC) + `contents/issues/pull-requests: write`.
