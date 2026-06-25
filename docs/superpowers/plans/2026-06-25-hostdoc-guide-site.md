# hostdoc Guide Site (GitHub Pages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an official single-page hostdoc guide on GitHub Pages, deployed from `docs/guide/` via GitHub Actions, and link it from README and the npm package.

**Architecture:** A self-contained static `docs/guide/index.html` (inline CSS, mermaid via CDN, anchor TOC) is uploaded by a dedicated `.github/workflows/pages.yml` using `upload-pages-artifact` + `deploy-pages` (no Jekyll, isolated from internal `docs/` content). `package.json` `homepage` and a README link point at the Pages URL.

**Tech Stack:** Static HTML/CSS, mermaid 11 (CDN), GitHub Actions Pages, `gh` CLI.

## Global Constraints

- Pages URL is fixed: `https://jkas2016.github.io/hostdoc/` (project page for repo `jkas2016/hostdoc`).
- Visual style: white background, single column `max-width: 880px`, tables + mermaid. **No** hero, dark mode, gradient, pulse, or display-serif fonts.
- Site source lives only in `docs/guide/`; never serve `docs/RELEASING.md` or `docs/superpowers/`.
- Document **current** template behavior: Terraform templates ship **in the npm package** (`dist/templates/infra/`) and are auto-extracted to `$XDG_STATE_HOME/hostdoc/infra` at `provision` — NOT pulled from a repo checkout.
- `ci.yml` must remain unchanged (AWS/Terraform-free). The new workflow performs no AWS/Terraform action.
- Mermaid diagrams must avoid `/`, `()`, `+`, and subgraph external references (known mermaid 11.x rendering quirks).
- All troubleshooting entries must use the real CLI error strings (verified in `src/`).
- Commit message trailer (every commit): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Work happens on branch `docs/guide-site` (already created; the spec is committed there).

---

### Task 1: Scaffold `docs/guide/index.html` — shell, style, header, TOC, Overview, Install

**Files:**
- Create: `docs/guide/index.html`

**Interfaces:**
- Consumes: nothing.
- Produces: an HTML document whose sections carry stable anchor `id`s consumed by the TOC and by Task 2: `overview`, `install`, `credentials`, `quickstart`, `domain`, `config`, `troubleshooting`, `agent`. (Task 1 creates `overview`, `install` and the TOC linking ALL eight; Task 2 fills the remaining six.)

- [ ] **Step 1: Create the file with the document shell, CSS, header, TOC, Overview, and Install**

Create `docs/guide/index.html` with exactly this content:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>hostdoc — Guide</title>
<style>
:root {
  --fg: #1a1a1a; --muted: #555; --border: #e0e0e0;
  --accent: #0b5fff; --code-bg: #f6f8fa; --max: 880px;
}
* { box-sizing: border-box; }
body { margin: 0; color: var(--fg); background: #fff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.65; font-size: 16px; }
main { max-width: var(--max); margin: 0 auto; padding: 48px 24px 96px; }
h1 { font-size: 2rem; margin: 0 0 .25em; }
h2 { font-size: 1.4rem; margin: 2.5em 0 .6em; padding-top: .4em; border-top: 1px solid var(--border); }
h3 { font-size: 1.1rem; margin: 1.6em 0 .5em; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code { background: var(--code-bg); padding: .15em .4em; border-radius: 4px;
  font-size: .9em; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
pre { background: var(--code-bg); padding: 16px; border-radius: 8px; overflow-x: auto; border: 1px solid var(--border); }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: .95em; }
th, td { border: 1px solid var(--border); padding: 8px 12px; text-align: left; vertical-align: top; }
th { background: var(--code-bg); }
.lead { color: var(--muted); font-size: 1.1rem; }
.toc { background: var(--code-bg); border: 1px solid var(--border); border-radius: 8px; padding: 8px 24px; }
.toc ol { margin: .4em 0; padding-left: 1.2em; }
.note { border-left: 3px solid var(--accent); background: #f5f8ff; padding: 12px 16px; margin: 1em 0; border-radius: 0 6px 6px 0; }
footer { margin-top: 4em; padding-top: 1.5em; border-top: 1px solid var(--border); color: var(--muted); font-size: .9em; }
.mermaid { margin: 1.5em 0; }
</style>
</head>
<body>
<main>
<h1>hostdoc</h1>
<p class="lead">Publish a local HTML file or folder to <strong>your own AWS</strong> and get a short shareable link.</p>

<nav class="toc">
<ol>
<li><a href="#overview">Overview</a></li>
<li><a href="#install">Prerequisites &amp; install</a></li>
<li><a href="#credentials">AWS credentials</a></li>
<li><a href="#quickstart">Quick start — no domain (S3 website)</a></li>
<li><a href="#domain">Domain mode (HTTPS via CloudFront)</a></li>
<li><a href="#config">Configuration &amp; precedence</a></li>
<li><a href="#troubleshooting">Troubleshooting</a></li>
<li><a href="#agent">Use with an agent (skill)</a></li>
</ol>
</nav>

<h2 id="overview">Overview</h2>
<p>hostdoc uploads your document to your own AWS account and returns a short link. It has two hosting modes that share one upload path; you pick a mode by how you configure it.</p>
<table>
<thead><tr><th></th><th>No domain (s3-website)</th><th>Domain (cloudfront)</th></tr></thead>
<tbody>
<tr><td>Link</td><td>HTTP</td><td>HTTPS</td></tr>
<tr><td>Bucket</td><td>Public S3 website bucket</td><td>Private S3, served via CloudFront (OAC)</td></tr>
<tr><td>Set up with</td><td><code>hostdoc setup</code> (CLI)</td><td><code>hostdoc provision</code> (Terraform)</td></tr>
<tr><td>Custom domain</td><td>No</td><td>Yes (Route53 hosted zone)</td></tr>
<tr><td>Use when</td><td>Quick internal sharing, no HTTPS needed</td><td>Public-facing links that must be HTTPS</td></tr>
</tbody>
</table>
<div class="mermaid">
flowchart TD
  A[Local file or folder] --> B[hostdoc publish]
  B --> C[Upload under a short code prefix with a meta sidecar]
  C --> D{Hosting mode}
  D -->|no domain| E[Public S3 website bucket]
  D -->|domain| F[Private S3 with CloudFront OAC]
  E --> G[HTTP shareable link]
  F --> H[HTTPS shareable link]
</div>

<h2 id="install">Prerequisites &amp; install</h2>
<ul>
<li><strong>Node.js ≥ 22.12</strong> (check with <code>node --version</code>).</li>
<li><strong>An AWS account</strong> with credentials available to the AWS SDK (see <a href="#credentials">AWS credentials</a>).</li>
<li>For domain mode only: <strong>Terraform</strong> installed and a <strong>Route53 hosted zone</strong>.</li>
</ul>
<pre><code>npm install -g hostdoc</code></pre>

</main>
<script type="module">
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
mermaid.initialize({ startOnLoad: true, theme: "neutral" });
</script>
</body>
</html>
```

- [ ] **Step 2: Verify the page renders with a clean console (chrome-devtools MCP)**

Using the chrome-devtools MCP:
1. `new_page` → `file:///Users/yeonikjo/Documents/Workspace/publish-aws-s3/docs/guide/index.html`
2. `list_console_messages` → Expected: no `error`-level messages (mermaid logs a parse error to console if the diagram is malformed).
3. `take_screenshot` → Expected: a white single-column page, the Overview table, and a rendered flowchart (not raw mermaid text).

- [ ] **Step 3: Commit**

```bash
git add docs/guide/index.html
git commit -m "docs(guide): scaffold guide page with overview and install (#6)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Author remaining sections — credentials, quick start, domain, config, troubleshooting, agent, footer

**Files:**
- Modify: `docs/guide/index.html` (insert sections after the Install section, before `</main>`)

**Interfaces:**
- Consumes: the document shell + the eight TOC anchor ids from Task 1.
- Produces: a complete page where every `href="#..."` in the TOC resolves to a matching section `id`.

- [ ] **Step 1: Insert the remaining sections**

In `docs/guide/index.html`, immediately after the Install `<pre>` block (the line `<pre><code>npm install -g hostdoc</code></pre>`) and before `</main>`, insert exactly:

```html
<h2 id="credentials">AWS credentials</h2>
<p>hostdoc <strong>never stores AWS keys</strong>. It uses the AWS SDK default credential chain (environment variables → SSO → shared <code>~/.aws</code> profile). Pick a profile with <code>--profile &lt;name&gt;</code> and a region with <code>--region &lt;region&gt;</code>. Use any one of the three setups below.</p>

<h3>Environment variables</h3>
<pre><code>export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=us-east-1</code></pre>

<h3>Shared profile</h3>
<p>Configure once, then select it per command:</p>
<pre><code>aws configure --profile hostdoc      # writes ~/.aws/credentials
hostdoc publish ./report.html --profile hostdoc</code></pre>

<h3>SSO</h3>
<pre><code>aws sso login --profile my-sso
hostdoc publish ./report.html --profile my-sso</code></pre>

<div class="note">Prefer a <strong>dedicated IAM user</strong> with a minimal policy over root credentials. See the AWS docs for <a href="https://docs.aws.amazon.com/IAM/latest/UserGuide/id_users_create.html">creating an IAM user</a> and <a href="https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_create.html">attaching a policy</a>. For domain mode, Terraform emits a ready-made minimal <code>publisher_policy_json</code> output (and can create the user with <code>create_publisher_user = true</code>).</div>

<h2 id="quickstart">Quick start — no domain (S3 website)</h2>
<p>This mode serves content <strong>publicly over HTTP</strong> from an S3 static-website bucket (S3 website endpoints do not support HTTPS). For HTTPS, see <a href="#domain">Domain mode</a>.</p>
<pre><code># 1) Create a public website bucket and save config
hostdoc setup --bucket my-unique-bucket --region us-east-1

# 2) Publish a file or a folder
hostdoc publish ./report.html            # -> http://&lt;bucket&gt;.s3-website-...amazonaws.com/&lt;code&gt;/
hostdoc publish ./site/ --slug aws-design

# 3) Manage
hostdoc list
hostdoc open aws-design
hostdoc rm aws-design --yes</code></pre>
<p><code>--dry-run</code> prints the URL it <em>would</em> publish to without uploading — and without any AWS call, so it works offline. <code>open</code> builds and opens the URL without checking the document exists. <code>rm</code> asks for confirmation; pass <code>--yes</code> to skip it (required when stdin is not a TTY).</p>

<h2 id="domain">Domain mode (HTTPS via CloudFront)</h2>
<p>Domain mode serves your docs over HTTPS from a fully private S3 bucket fronted by CloudFront (OAC). It is provisioned with Terraform.</p>
<p><strong>Prerequisites:</strong> a Route53 hosted zone for your domain, AWS credentials, and Terraform installed. <strong>No repo checkout is needed</strong> — the Terraform templates ship inside the npm package and are extracted for you into <code>$XDG_STATE_HOME/hostdoc/infra</code> (i.e. <code>~/.local/state/hostdoc/infra</code>).</p>
<pre><code>hostdoc provision \
  --hosted-zone example.com \
  --subdomain shared \
  --region us-east-1
# extracts bundled Terraform, writes terraform.tfvars.json from the flags,
# runs terraform init + apply, and saves config (~15-30 min).
# non-interactive (e.g. driving hostdoc from an agent): add --approve
hostdoc publish ./mydoc      # -> https://shared.example.com/&lt;code&gt;/</code></pre>
<p>The single local <code>terraform.tfstate</code> lives in that per-user dir, so it is reused no matter where you run hostdoc from, and <code>deprovision</code> always finds it. Override the location with <code>--dir</code>. Re-running <code>provision</code> never clobbers a dir you have already edited. <code>--price-class</code> overrides the default <code>PriceClass_100</code>.</p>
<p>Already provisioned the infra yourself? Import it without applying: <code>hostdoc init --from-terraform &lt;dir&gt;</code>. Tear it all down with <code>hostdoc deprovision</code> (reuses the saved <code>terraform.tfvars.json</code>; add <code>--approve</code> for non-interactive). Overwriting (<code>--force</code>) and <code>hostdoc rm</code> automatically invalidate <code>/&lt;code&gt;/*</code> on the distribution.</p>
<h3>External (non-Route53) DNS</h3>
<p>Automated ACM validation and alias records require a Route53 hosted zone. If your domain is hosted elsewhere (e.g. Cloudflare), provisioning is manual: add the ACM validation CNAME shown by AWS, then point your subdomain at the CloudFront distribution domain via a CNAME/ALIAS record.</p>

<h2 id="config">Configuration &amp; precedence</h2>
<p>Settings resolve in this order (earlier wins):</p>
<table>
<thead><tr><th>Priority</th><th>Source</th><th>Example</th></tr></thead>
<tbody>
<tr><td>1 (highest)</td><td>CLI flags</td><td><code>--bucket</code>, <code>--region</code>, <code>--profile</code></td></tr>
<tr><td>2</td><td>Environment variables</td><td><code>HOSTDOC_BUCKET</code>, <code>HOSTDOC_REGION</code>, <code>HOSTDOC_DISTRIBUTION</code></td></tr>
<tr><td>3 (lowest)</td><td>Config file</td><td><code>~/.config/hostdoc/config.json</code></td></tr>
</tbody>
</table>
<p>This lets you point hostdoc at bring-your-own infrastructure. Inspect the saved config with <code>hostdoc config</code>.</p>

<h2 id="troubleshooting">Troubleshooting</h2>
<table>
<thead><tr><th>Message / symptom</th><th>Cause &amp; fix</th></tr></thead>
<tbody>
<tr><td><code>No configuration found. Run hostdoc setup ...</code></td><td>Not set up yet — run <code>hostdoc setup</code> (no domain) or <code>hostdoc provision</code> (domain), or pass <code>--bucket/--region</code> (or <code>HOSTDOC_BUCKET/HOSTDOC_REGION</code>).</td></tr>
<tr><td><code>Invalid config at &lt;path&gt;: not valid JSON</code> / <code>expected a JSON object</code></td><td>The config file is corrupted. Fix or delete <code>~/.config/hostdoc/config.json</code> and re-run setup.</td></tr>
<tr><td><code>Incomplete cloudfront config: 'domain' set without 'distributionId'</code></td><td>Domain is set but the distribution id is missing. Set <code>--distribution</code> / <code>HOSTDOC_DISTRIBUTION</code>, run <code>hostdoc init --from-terraform &lt;dir&gt;</code>, or unset the domain for s3-website mode.</td></tr>
<tr><td><code>Incomplete cloudfront config: bucket and region are required</code></td><td>Run <code>hostdoc init --from-terraform &lt;dir&gt;</code> to import the bucket and region.</td></tr>
<tr><td>Credentials error (e.g. <code>Could not load credentials from any providers</code>)</td><td>No usable AWS credentials. Configure env vars, a <code>--profile</code>, or SSO (see <a href="#credentials">AWS credentials</a>).</td></tr>
<tr><td><code>terraform is not installed or not on PATH ...</code></td><td>Install Terraform (e.g. <code>brew install terraform</code>) and retry.</td></tr>
<tr><td><code>No terraform.tfvars in "&lt;dir&gt;". Pass --hosted-zone ... --subdomain ...</code></td><td>Run <code>provision</code>/<code>deprovision</code> from the provisioned dir, or pass <code>--hosted-zone</code> and <code>--subdomain</code>.</td></tr>
<tr><td><code>Could not read terraform outputs from "&lt;dir&gt;" ...</code></td><td>Ensure Terraform is installed and <code>terraform apply</code> has run in that dir before <code>init --from-terraform</code>.</td></tr>
<tr><td><code>Slug "&lt;x&gt;" already exists. Use --force to overwrite.</code></td><td>Pick a different <code>--slug</code> or pass <code>--force</code> (force also invalidates the CloudFront path in domain mode).</td></tr>
<tr><td><code>Path not found</code> / <code>Folder is empty</code> / <code>Document not found</code></td><td>Check the file/folder path you published, or the id you passed to <code>open</code>/<code>rm</code>.</td></tr>
</tbody>
</table>

<h2 id="agent">Use with an agent (skill)</h2>
<p>hostdoc ships an installable agent skill so coding agents can drive it conversationally — "publish this folder", "list my docs", "remove that slug" — without memorizing flags.</p>
<pre><code>npx skills add jkas2016/hostdoc</code></pre>
<p>The skill shells out to the hostdoc CLI (preferring a global install, falling back to <code>npx -y hostdoc</code>), so no global install is required. It runs an AWS-free preflight and turns missing config/credentials into guidance instead of raw errors.</p>

<footer>
hostdoc — <a href="https://github.com/jkas2016/hostdoc">GitHub</a> ·
<a href="https://www.npmjs.com/package/hostdoc">npm</a> ·
<a href="https://github.com/jkas2016/hostdoc/issues">Issues</a>
</footer>
```

- [ ] **Step 2: Verify every TOC anchor resolves**

Run:

```bash
node -e '
const fs=require("fs");
const h=fs.readFileSync("docs/guide/index.html","utf8");
const hrefs=[...h.matchAll(/href="#([\w-]+)"/g)].map(m=>m[1]);
const ids=new Set([...h.matchAll(/id="([\w-]+)"/g)].map(m=>m[1]));
const missing=hrefs.filter(a=>!ids.has(a));
if(missing.length){console.error("UNRESOLVED anchors:",missing);process.exit(1);}
console.log("OK:",hrefs.length,"TOC anchors all resolve");
'
```

Expected: `OK: 8 TOC anchors all resolve`

- [ ] **Step 3: Verify full-page render (chrome-devtools MCP)**

1. `navigate_page` (or `new_page`) → `file:///Users/yeonikjo/Documents/Workspace/publish-aws-s3/docs/guide/index.html`
2. `list_console_messages` → Expected: no `error`-level messages.
3. `take_screenshot` (fullPage) → Expected: all eight sections present, tables and the flowchart render.

- [ ] **Step 4: Commit**

```bash
git add docs/guide/index.html
git commit -m "docs(guide): author credentials, modes, config, troubleshooting (#6)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Pages deploy workflow

**Files:**
- Create: `.github/workflows/pages.yml`

**Interfaces:**
- Consumes: `docs/guide/` (the artifact path).
- Produces: a workflow that, on push to `main` touching `docs/guide/**`, deploys the folder to GitHub Pages.

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/pages.yml` with exactly:

```yaml
name: Pages

on:
  push:
    branches: [main]
    paths:
      - 'docs/guide/**'
      - '.github/workflows/pages.yml'
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
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: docs/guide
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Verify the YAML parses**

Run:

```bash
ruby -ryaml -e 'YAML.load_file(".github/workflows/pages.yml"); puts "pages.yml is valid YAML"'
```

Expected: `pages.yml is valid YAML`

- [ ] **Step 3: Confirm `ci.yml` is untouched**

Run:

```bash
git status --porcelain .github/workflows/ci.yml
```

Expected: empty output (no changes to `ci.yml`).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/pages.yml
git commit -m "ci(pages): deploy docs/guide to GitHub Pages (#6)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Cross-link from package.json and README

**Files:**
- Modify: `package.json` (add `homepage` after the `repository` block)
- Modify: `README.md` (add a documentation link near the top)

**Interfaces:**
- Consumes: the fixed Pages URL.
- Produces: `package.json` `homepage` and a README link, both pointing at the guide.

- [ ] **Step 1: Add `homepage` to package.json**

In `package.json`, change:

```json
  "repository": {
    "type": "git",
    "url": "git+https://github.com/jkas2016/hostdoc.git"
  },
  "type": "module",
```

to:

```json
  "repository": {
    "type": "git",
    "url": "git+https://github.com/jkas2016/hostdoc.git"
  },
  "homepage": "https://jkas2016.github.io/hostdoc/",
  "type": "module",
```

- [ ] **Step 2: Add the guide link to README**

In `README.md`, change the top:

```markdown
Publish a local HTML file or folder to **your own AWS** and get a short shareable link.
```

to:

```markdown
Publish a local HTML file or folder to **your own AWS** and get a short shareable link.

📖 **[Full guide & documentation](https://jkas2016.github.io/hostdoc/)**
```

- [ ] **Step 3: Verify both links**

Run:

```bash
node -e 'const u=require("./package.json").homepage; if(u!=="https://jkas2016.github.io/hostdoc/"){console.error("bad homepage:",u);process.exit(1)}; console.log("homepage OK:",u)'
grep -F "https://jkas2016.github.io/hostdoc/" README.md
```

Expected: `homepage OK: https://jkas2016.github.io/hostdoc/` and a matching grep line from README.

- [ ] **Step 4: Verify package.json is still valid JSON**

Run:

```bash
node -e 'JSON.parse(require("fs").readFileSync("package.json","utf8")); console.log("package.json valid")'
```

Expected: `package.json valid`

- [ ] **Step 5: Commit**

```bash
git add package.json README.md
git commit -m "docs: link README and npm homepage to the guide site (#6)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Enable Pages and verify the live site (post-merge, operational)

> This task can only complete **after the branch is merged to `main`** (the deploy workflow triggers on push to `main`). It requires a `gh` login with repo admin rights and network access. Do not run it until the PR is merged.

**Files:** none (operational only).

**Interfaces:**
- Consumes: the merged `pages.yml`, the live Pages URL.
- Produces: a reachable Pages site satisfying the issue's acceptance criteria.

- [ ] **Step 1: Enable GitHub Pages with the Actions build type**

Run (POST creates it; if it already exists, the second command updates it):

```bash
gh api -X POST repos/jkas2016/hostdoc/pages -f build_type=workflow \
  || gh api -X PUT repos/jkas2016/hostdoc/pages -f build_type=workflow
```

Expected: JSON describing the Pages site (or no error on PUT). If the API rejects it, set it manually in Settings → Pages → Source = "GitHub Actions".

- [ ] **Step 2: Confirm the deploy workflow ran on main**

Run:

```bash
gh run list --workflow=pages.yml --branch main --limit 3
```

Expected: a recent run with `completed` / `success`. If none, trigger one: `gh workflow run pages.yml --ref main`, then re-check.

- [ ] **Step 3: Verify the live URL serves the guide**

Run:

```bash
curl -fsSL https://jkas2016.github.io/hostdoc/ | grep -F '<h1>hostdoc</h1>' && echo "LIVE OK"
```

Expected: the matching `<h1>` line and `LIVE OK`. (Allow a minute or two after the deploy for propagation.)

- [ ] **Step 4: Confirm acceptance criteria**

- Public Pages URL reachable (Step 3 ✓).
- README and npm both link to it (Task 4 ✓; npm reflects `homepage` on the next publish).
- Both hosting modes documented end to end (Tasks 1–2 ✓).

Then close issue #6 referencing the merged PR.

---

## Self-Review

**Spec coverage:**
- Pages source = Actions deploying `docs/guide/` → Task 3 + Task 5. ✓
- Single page + anchor TOC, info-first style → Task 1 (shell/CSS/TOC) + Task 2 (sections). ✓
- Sections: overview(+table+mermaid), install, credentials walkthrough, no-domain quickstart, domain mode, config precedence, troubleshooting, agent, footer → Tasks 1–2. ✓
- Stale-issue reconciliation (templates ship in npm) → Task 2 domain section + Global Constraints. ✓
- npm `homepage` + README link → Task 4. ✓
- Verification: local render, anchors, live URL, links → Tasks 1/2/4/5. ✓
- `ci.yml` untouched invariant → Task 3 Step 3. ✓

**Placeholder scan:** No TBD/TODO; all code/content blocks are complete and copy-pasteable. ✓

**Type/name consistency:** Anchor ids (`overview`, `install`, `credentials`, `quickstart`, `domain`, `config`, `troubleshooting`, `agent`) are defined in Task 1's TOC and created across Tasks 1–2; the Task 2 anchor check asserts all 8 resolve. Pages URL identical everywhere. Artifact path `docs/guide` matches between workflow and content tasks. ✓
