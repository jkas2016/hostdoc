---
name: hostdoc
description: Publish a local HTML file or folder to the user's own AWS and return a short shareable link, and manage published docs. Use when the user says things like "publish this HTML/folder", "get a shareable link for this doc", "list/open/remove my published docs", or "set up hosting on my AWS". Wraps the hostdoc CLI — it does not reimplement any logic.
---

# hostdoc

Drive the [`hostdoc`](https://www.npmjs.com/package/hostdoc) CLI to publish local
HTML to the user's own AWS and return a short link. This skill only shells out to
the CLI; it never reimplements upload/provision logic and never handles AWS
credentials itself.

## Running the CLI

Always invoke the CLI through the wrapper so resolution and error guidance are
consistent — never call `hostdoc` directly:

```bash
node <skill>/scripts/run.mjs <command> [args…]
```

`<skill>` is this skill's directory. The wrapper resolves the CLI in order:
`HOSTDOC_BIN` (override) → `hostdoc` on `PATH` → `npx -y hostdoc`. So it works
whether or not the user installed hostdoc globally — no global install required.

## Workflow

1. **Preflight before any AWS-touching command** (`publish`, `list`, `open`,
   `rm`, `provision`, `deprovision`):

   ```bash
   node <skill>/scripts/preflight.mjs
   ```

   If it reports missing config or credentials, relay that guidance and help the
   user resolve it instead of running the command. (`config`/`--help` need no
   preflight.)

2. **Map the request to a command** (see `references/commands.md` for all flags):
   - "publish this file/folder", "share this doc" → `publish <path>` (`--slug`,
     `--title`, `--force`, `--open`, `--dry-run`)
   - "list my docs" → `list`
   - "open <id>" → `open <id>`
   - "remove/delete <id>" → `rm <id> --yes`
   - "set up hosting" → `setup --bucket <name> --region <r>` (HTTP S3-website)
   - "set up a custom domain / HTTPS" → `provision --hosted-zone <z> --subdomain
     <s> --region <r>` (add `--approve` when running non-interactively)

3. **Run it** through `run.mjs` and **return the printed URL/result** to the user.

4. **On failure**, the wrapper prints a `hostdoc-skill:` guidance line — relay it.
   For unmapped errors see `references/troubleshooting.md`.

## Two hosting modes

- **s3-website** (default, HTTP): created by `setup`; links look like
  `http://<bucket>.s3-website-<region>.amazonaws.com/<code>/`.
- **cloudfront** (HTTPS, custom domain): provisioned by `provision` (Terraform,
  ~15–30 min); links look like `https://<subdomain>.<zone>/<code>/`.

`config` (AWS-free) prints the active mode. Full flags, config precedence, and the
credential model are in `references/commands.md`.
