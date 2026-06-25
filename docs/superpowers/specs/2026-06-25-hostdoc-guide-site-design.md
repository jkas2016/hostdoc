# hostdoc Official Guide Site (GitHub Pages) — Design

- **Issue:** [#6 — \[Docs\] Official guide site on GitHub Pages + documentation expansion](https://github.com/jkas2016/hostdoc/issues/6)
- **Date:** 2026-06-25
- **Status:** Approved (brainstorming)

## Problem

`hostdoc@1.1.x` is public on npm, but the only documentation is `README.md` (117 lines). New users have no onboarding path from "install" to "first published link" without reading source. We need an official guide site on GitHub Pages and expanded prose, covering both hosting modes end to end.

## Goals

- A public, reachable GitHub Pages URL serving a guide for both hosting modes.
- README and the npm package both link to it.
- Prose expanded beyond the current README — especially AWS credentials setup and troubleshooting.

## Non-goals (from the issue)

- A heavy docs framework when a simple static site suffices.
- Auto-generated API reference (this is a CLI, not a library).
- Versioned docs (single "latest" is fine).

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Pages source | **GitHub Actions** deploying the `docs/guide/` folder only |
| Site structure | **Single page** (`docs/guide/index.html`) with a top anchor TOC |
| Visual style | Info-first HTML: white base, single column 880px, tables + mermaid; no hero/dark/gradient/pulse/display-serif |
| AWS credentials depth | **Practical walkthrough** (env / profile / SSO copy-paste examples) + official AWS links for IAM user & minimal policy |
| Cross-linking | README → guide; `package.json` `homepage` → guide |

### Why Actions over branch-deploy

GitHub Pages "Deploy from a branch" can only serve `/` or `/docs`. Serving `/docs` would expose the internal `docs/RELEASING.md` and `docs/superpowers/` specs inside the site tree (cosmetically messy, though already public). Deploying an **arbitrary folder** (`docs/guide/`) requires Actions. `actions/upload-pages-artifact` serves the artifact as-is (no Jekyll), so the site stays isolated from internal docs and there are no Jekyll surprises. Cost: one small workflow file.

## Correctness note — reconcile stale issue wording

The issue's References say "the `infra/` Terraform comes from the repo (not the npm package)." **This is outdated.** Verified current behavior (`scripts/copy-templates.mjs`, `src/lib/templates.ts`, `dist/templates/infra/`): the variable-only Terraform templates are **bundled into the npm package** (`dist/templates/infra/`) and extracted at `provision` time into `$XDG_STATE_HOME/hostdoc/infra`. Source runs (`npm run dev`) fall back to the repo's `infra/` only because the bundled dir is absent there. **The guide documents the current behavior: templates ship with npm and are auto-extracted; no repo checkout needed.**

## Architecture / Deliverables

### 1. Site source — `docs/guide/index.html`

Single self-contained HTML file:
- Inline `<style>` (no external CSS); mermaid via CDN `<script type="module">` import.
- Info-first style tokens: white background, `max-width: 880px`, single column, system/sans font stack, restrained accent color, bordered tables, code blocks with subtle background.
- Top anchor TOC linking to each section `id`.
- All links relative or absolute-external; no inter-page links (single page).

### 2. Deploy workflow — `.github/workflows/pages.yml`

```yaml
name: Pages
on:
  push:
    branches: [main]
    paths: ['docs/guide/**', '.github/workflows/pages.yml']
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: docs/guide
      - id: deployment
        uses: actions/deploy-pages@v4
```

Separate from `ci.yml` (which stays AWS/Terraform-free and untouched). This workflow performs no AWS or Terraform action — it only uploads static files.

### 3. Enable Pages (one-time)

Set the repo's Pages source to "GitHub Actions" (`build_type: workflow`). Plan will use:

```bash
gh api -X POST repos/jkas2016/hostdoc/pages -f build_type=workflow
# (or PUT if Pages already exists)
```

If the API path needs adjustment, fall back to the repo Settings → Pages → Source = "GitHub Actions" toggle.

### 4. `package.json` — homepage

Add `"homepage": "https://jkas2016.github.io/hostdoc/"`. The URL is deterministic for a project page, so it can be set before the first deploy.

### 5. `README.md` — cross-link

Add a prominent "📖 Documentation" link near the top pointing to the guide site. Keep the README itself; the guide is the expanded version, not a replacement.

## Page content (single page, anchored sections)

1. **Header + one-line intro + TOC.**
2. **Overview** — two-mode comparison table (s3-website vs cloudfront: protocol HTTP/HTTPS, bucket public/private, provisioning CLI `setup` vs Terraform `provision`, when to use each) + a **mermaid diagram** of the shared data flow (local file/folder → upload to `<code>/` prefix + `_meta/<code>.json` sidecar → mode branch → shareable link). Mermaid kept simple (no subgraph external refs, no special chars) per known mermaid 11.x quirks.
3. **Prerequisites & Install** — Node ≥ 22.12, `npm install -g hostdoc`, an AWS account.
4. **AWS credentials (practical walkthrough)** — hostdoc uses the AWS SDK default credential chain and never stores keys. Three copy-paste blocks:
   - Environment variables (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION`).
   - Shared profile (`~/.aws/credentials` + `hostdoc … --profile <name>`).
   - SSO (`aws sso login` + profile).
   - Link to official AWS docs for creating an IAM user and attaching a minimal policy (and reference the Terraform `publisher_policy_json` output for domain mode).
5. **Quick start — no domain (S3 website)** — `setup --bucket --region` → `publish` (file and folder, `--slug`) → `list` / `open` / `rm --yes` → `--dry-run` (offline, no AWS call). Note: serves publicly over HTTP (S3 website endpoints have no HTTPS).
6. **Domain mode (HTTPS via CloudFront)** — prerequisites: Route53 hosted zone, AWS credentials, Terraform installed. State that **templates ship with the npm package and are auto-extracted** to `$XDG_STATE_HOME/hostdoc/infra` (no repo checkout). Flow: `provision --hosted-zone --subdomain --region` (+`--approve` for non-interactive, `--price-class`, `--dir`), `init --from-terraform <dir>` (import without applying), `deprovision`. Note auto-invalidation of `/<code>/*` on `--force`/`rm`. Subsections: external (non-Route53) DNS manual steps; security note (prefer a dedicated IAM user / `create_publisher_user = true`).
7. **Configuration & precedence** — table: flags > `HOSTDOC_*` env > `~/.config/hostdoc/config.json`; mention `hostdoc config`.
8. **Troubleshooting** — table grounded in real CLI error strings:
   - `No configuration found. Run hostdoc setup …` → not set up / wrong `XDG_CONFIG_HOME`.
   - `Invalid config at <path>: not valid JSON` / `expected a JSON object` → corrupted config file.
   - `Incomplete cloudfront config: 'domain' set without 'distributionId'` and `… bucket and region are required` → run `init --from-terraform`.
   - `terraform is not installed or not on PATH …` → install Terraform.
   - `No terraform.tfvars in "<dir>". Pass --hosted-zone … --subdomain …` → provide flags or run from the provisioned dir.
   - `Could not read terraform outputs from "<dir>" …` → ensure `terraform apply` ran there.
   - Missing/invalid AWS credentials → SDK chain error ("Could not load credentials …"); fix env/profile/SSO.
   - `Slug "<x>" already exists. Use --force to overwrite.` / `Document not found: <id>` / `Path not found` / `Folder is empty`.
9. **Use with an agent (skill)** — brief; `npx skills add jkas2016/hostdoc`; link to README section.
10. **Footer** — links: GitHub repo, npm package, issues.

## Testing / Verification

- **Local render:** open `docs/guide/index.html` via chrome-devtools MCP — console clean (no errors), mermaid renders, every TOC anchor resolves to its section.
- **Post-deploy:** fetch the Pages URL (`https://jkas2016.github.io/hostdoc/`) → HTTP 200 + expected content present. Confirm the README link and `package.json` homepage resolve to it.
- **CI invariant:** `ci.yml` unchanged; new `pages.yml` touches no AWS/Terraform.

## Acceptance criteria (from the issue)

- [ ] A public Pages URL serves the guide and is reachable.
- [ ] README and npm package link to it.
- [ ] Both hosting modes are documented end to end.

## Out of scope / follow-ups

- Custom domain for the Pages site, search, analytics, dark mode.
- Migrating README content wholesale into the site (README stays; guide expands).
