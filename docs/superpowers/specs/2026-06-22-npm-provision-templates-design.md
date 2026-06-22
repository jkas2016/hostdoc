# Bundle Terraform templates so npm-installed users can run `provision`

**Issue:** [jkas2016/hostdoc#8](https://github.com/jkas2016/hostdoc/issues/8)
**Date:** 2026-06-22
**Status:** Approved — ready for implementation plan

## Problem

`hostdoc provision` / `deprovision` shell out to Terraform against `--dir` (default
`./infra`), but the CLI neither ships nor generates the Terraform code. `package.json`
declares `files: ["dist"]`, so `infra/` is not in the npm tarball. A user who installs via
the documented path (`npm i -g hostdoc`) has no `.tf` files, so `provision` fails:

```
$ hostdoc provision
Error handling -chdir option: chdir ./infra: no such file or directory
```

Domain (HTTPS/CloudFront) mode — a headline feature — is therefore unusable without a repo
checkout, and that prerequisite is undocumented.

## Goal

`npm i -g hostdoc` then `hostdoc provision --hosted-zone <z> --subdomain <s> --region <r>`
provisions domain mode with **no repo checkout and no file editing**, and `deprovision`
tears it down the same way.

## Approach (Issue Option B, with refinements)

Bundle a clean, variable-only copy of the Terraform templates as a package asset; on
`provision`/`deprovision`, extract them into `--dir` when absent, generate
`terraform.tfvars` from CLI flags, then run terraform. State and the user's values live only
in the user's working dir.

### Decisions made during brainstorming

1. **Template source = build-time allowlist copy.** The six git-tracked clean files already
   in `infra/` are the single source of truth. A build step copies *only* an explicit
   allowlist into `dist/templates/infra/`. This avoids the drift of a hand-maintained
   duplicate directory and makes a state/tfvars leak structurally impossible (allowlist, not
   denylist).
2. **Variable passing = generate `terraform.tfvars`.** Written once into the user's working
   dir; `provision` → `deprovision` reuses it, so `destroy` needs no re-typing of the domain.
   (Terraform's three no-default variables are required at plan time even for `destroy`.)
3. **Flag precedence = flags win, tfvars is a cache.** Flags drive everything; tfvars is a
   persisted cache. Serves the "CLI args only, no file editing" goal.
4. **PR scope.** Core implementation + tests, README update, and a tarball guardrail test.
   The guide site (#6) is a separate issue and out of scope here.

### Why not Option A (ship `infra/` and run terraform in the package dir)

- **Leak risk:** packaging the maintainer's `infra/` risks shipping `terraform.tfstate` /
  `terraform.tfvars` (real domain `yeonigi.com`, account id, distribution ids) if ignore
  rules ever slip.
- **Pollution / rigidity:** terraform would write state + providers into the global install
  dir (shared/read-only), and domain values would require editing a file inside
  `node_modules` — not "CLI args only."

## Architecture

```
CLI flags ──▶ { dir, approve, flags:{hostedZone, subdomain, region, priceClass?} }
   │
   ├─▶ extractTemplates(dir)    # dist/templates/infra → dir (only when no .tf present)
   ├─▶ ensureTfvars(dir, flags) # flags → dir/terraform.tfvars (or reuse existing cache)
   ├─▶ terraform -chdir=dir init/apply (provision) | init/destroy (deprovision)
   └─▶ runInit(dir): terraform output -json → ~/.config/hostdoc/config.json   (provision only)
```

The invariant `extractTemplates → ensureTfvars → terraform` is shared by both commands.

## Components

### Build: `scripts/copy-templates.mjs` (new)

Copies an explicit allowlist from `infra/` into `dist/templates/infra/`:

```
main.tf  variables.tf  outputs.tf  index-rewrite.js  terraform.tfvars.example  .terraform.lock.hcl
```

- Wired into build: `"build": "tsc && node scripts/copy-templates.mjs"`. `prepack` already
  runs `npm run build`, so the templates ship automatically.
- `files: ["dist"]` is unchanged — the templates live under `dist/`.
- `.terraform.lock.hcl` is included: its 16 `zh:` registry hashes cover all platforms (so
  cross-platform `terraform init` verifies fine), and it pins the AWS provider to exactly
  `6.51.0` — stronger reproducibility than `main.tf`'s `>= 5.0` floor. It is a git-tracked
  clean file, consistent with the allowlist rule.

### Runtime: `src/lib/templates.ts` (new)

- `bundledTemplatesDir(): string` — `fileURLToPath(new URL("../templates/infra/", import.meta.url))`.
  From `dist/lib/templates.js` this resolves to `dist/templates/infra/`.
- `hasTfFiles(dir): boolean` — whether `dir` contains any `*.tf`.
- `extractTemplates(destDir, srcDir = bundledTemplatesDir()): { extracted: boolean }` —
  if `hasTfFiles(destDir)`, **no-op (never clobber existing files)**; otherwise `mkdir -p`
  and copy each allowlisted file from `srcDir`. `srcDir` is injectable so tests run without a
  build.

### Runtime: `src/lib/tfvars.ts` (new)

- `writeTfvars(dir, vars): void` — serialize HCL with value escaping:
  ```hcl
  hosted_zone_name = "example.com"
  subdomain        = "shared"
  aws_region       = "us-east-1"
  price_class      = "PriceClass_100"   # only emitted when provided
  ```
  `create_publisher_user` is left to its tf default (`false`); not exposed.
- `hasTfvars(dir): boolean`.
- `ensureTfvars(dir, flags): void` — centralizes the flags-win / tfvars-cache rule:
  - all three required (`hostedZone`, `subdomain`, `region`) present → `writeTfvars` (overwrites any existing).
  - some-but-not-all present → throw, naming the missing flags.
  - none present + existing `terraform.tfvars` → use it.
  - none present + no `terraform.tfvars` → throw ("provide --hosted-zone/--subdomain/--region or a terraform.tfvars in <dir>").
  - `priceClass` is optional in every branch (tf default applies).

### Commands

- `src/commands/provision.ts` — `runProvision({ dir, approve, flags? }): Config`:
  `extractTemplates(dir)` → `ensureTfvars(dir, flags)` → `terraform init -input=false` →
  `apply` (`-auto-approve` when `approve`) → `runInit({ dir })`.
- `src/commands/deprovision.ts` — `runDeprovision({ dir, approve, flags? }): void`:
  `extractTemplates(dir)` → `ensureTfvars(dir, flags)` → `terraform init` → `destroy`.
- `src/index.ts` — add `--hosted-zone <zone>`, `--subdomain <sub>`, `--region <region>`,
  `--price-class <class>` to both `provision` and `deprovision`; collect into a `flags`
  object and pass through.

### Flag → variable mapping

| CLI flag | tfvars key | required | default |
|---|---|---|---|
| `--hosted-zone` | `hosted_zone_name` | yes | — |
| `--subdomain` | `subdomain` | yes | — |
| `--region` | `aws_region` | yes | — |
| `--price-class` | `price_class` | no | `PriceClass_100` (tf) |

## Error handling

- Missing bundled-templates dir (build slipped) → clear error. The maintainer/dev path is
  unaffected because `./infra` already has `.tf`, so extraction is skipped entirely.
- Partial flags / no flags and no tfvars → `ensureTfvars` blocks **before** terraform runs.
- terraform not installed (ENOENT) → existing friendly message is preserved.

## Test plan (written before production code)

terraform is mocked via `vi.mock("node:child_process")` (existing convention). Filesystem
work uses real temp dirs.

- **`test/templates.test.ts`**
  - `extractTemplates` copies all six allowlisted files into an empty dir (fixture `srcDir`,
    no build needed); returns `extracted: true`.
  - `extractTemplates` is a no-op when `destDir` already contains a `.tf` (existing files
    untouched); returns `extracted: false`.
- **`test/tfvars.test.ts`**
  - `writeTfvars` emits correct HCL for required + `price_class`.
  - `writeTfvars` omits `price_class` when absent.
  - value escaping (e.g. embedded quotes).
  - `ensureTfvars` four branches: all-three → writes; partial → throws naming missing;
    none + existing tfvars → ok; none + no tfvars → throws.
- **`test/provision.test.ts`** (extend) — temp dir + fixture `srcDir`: extracts templates and
  writes tfvars from flags, then init/apply (mocked); flags overwrite an existing tfvars.
- **`test/deprovision.test.ts`** (extend) — flags passthrough; uses existing tfvars when no
  flags.
- **`test/pack.test.ts`** (new) — `npm pack --dry-run --json --ignore-scripts` file list
  includes `dist/templates/infra/*` and excludes any `*.tfstate*` / `terraform.tfvars`.

## Documentation

- **README** — add the npm-only domain-mode flow: `npm i -g hostdoc` →
  `hostdoc provision --hosted-zone <z> --subdomain <s> --region <r>` (no repo checkout, no
  file editing). Remove/correct the `cd infra` prerequisite.

## Acceptance criteria

- [ ] `npm i -g hostdoc` then `hostdoc provision --hosted-zone <z> --subdomain <s> --region <r>`
      provisions domain mode with no repo checkout and no file editing.
- [ ] Published tarball contains the variable-only templates and **no** `*.tfstate*` /
      `terraform.tfvars`.
- [ ] `deprovision` works the same way against the extracted dir.
- [ ] Re-running `provision` in a dir that already has `.tf` does not clobber existing files.

## Out of scope

- Guide site (#6) — separate issue.
- Exposing `create_publisher_user` as a flag — keep the tf default (`false`).

## References

- `package.json` (`files: ["dist"]`), `src/commands/provision.ts`,
  `src/commands/deprovision.ts`, `src/lib/terraform.ts`, `src/commands/init.ts`,
  `infra/variables.tf`, `infra/outputs.tf`, `infra/.terraform.lock.hcl`.
- Related: #6 (guide site / docs must cover the npm-only domain flow).
