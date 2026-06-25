# hostdoc

Publish a local HTML file or folder to **your own AWS** and get a short shareable link.

📖 **[Full guide & documentation](https://jkas2016.github.io/hostdoc/)**

> Phase 1 ships the **no-domain (S3 website)** mode: an HTTP link served straight from an S3 static-website bucket. Custom-domain HTTPS via CloudFront is Phase 2.

## Install

```bash
npm install -g hostdoc
```

## Quick start (no domain)

Requires AWS credentials available to the SDK (env vars, a shared profile via `--profile`, or SSO).

```bash
# 1) Create a public website bucket and save config
hostdoc setup --bucket my-unique-bucket --region us-east-1

# 2) Publish
hostdoc publish ./report.html            # → http://<bucket>.s3-website-...amazonaws.com/<code>/
hostdoc publish ./site/ --slug aws-design

# 3) Manage
hostdoc list
hostdoc open aws-design
hostdoc rm aws-design --yes
```

`--dry-run` prints the URL it *would* publish to without uploading — and without any AWS call, so it works offline / with no credentials configured.

`open` builds and opens the URL without verifying the document exists; an unknown id just opens a 403/404 page. `rm` asks for confirmation before deleting — pass `--yes` to skip it (required when stdin is not a TTY).

Note: no-domain mode serves content **publicly over HTTP** (S3 website endpoints do not support HTTPS). For public-facing HTTPS, see [Domain mode](#domain-mode-https-via-cloudfront) below.

## Domain mode (HTTPS via CloudFront)

Domain mode serves your docs over HTTPS from a fully private S3 bucket fronted
by CloudFront (OAC). It is provisioned with Terraform.

**Prerequisites:** a Route53 hosted zone for your domain, AWS credentials, and
Terraform installed. No repo checkout needed — the Terraform templates ship
with the npm package and are extracted for you.

```bash
hostdoc provision \
  --hosted-zone example.com \
  --subdomain shared \
  --region us-east-1
# extracts bundled Terraform into ~/.local/state/hostdoc/infra, writes
# terraform.tfvars.json from the flags, then runs terraform init + apply and saves
# the config (~15-30 min).
# non-interactive (e.g. driving hostdoc from an agent): add --approve
hostdoc publish ./mydoc      # → https://shared.example.com/<code>/
```

The templates land in a per-user, cwd-independent directory by default —
`$XDG_STATE_HOME/hostdoc/infra` (i.e. `~/.local/state/hostdoc/infra`) — so the
single local `terraform.tfstate` is reused no matter where you run `hostdoc`
from, and `deprovision` always finds it. Override with `--dir`. Re-running
`provision` never clobbers a dir you have already edited. Optional
`--price-class` overrides the default `PriceClass_100`.

Already provisioned the infra yourself? Import it without applying:
`hostdoc init --from-terraform <dir>`.

Tear it all down with `hostdoc deprovision` (it reuses the `terraform.tfvars.json`
written during provision; or pass the same flags). Add `--approve` to run it
non-interactively.

Overwriting (`--force`) and `hostdoc rm` automatically invalidate
`/<code>/*` on the distribution.

### External (non-Route53) DNS

Automated ACM validation and alias records require a Route53 hosted zone. If
your domain is hosted elsewhere (e.g. Cloudflare), provisioning is manual:
add the ACM validation CNAME shown by AWS, then point your subdomain at the
CloudFront distribution domain via a CNAME/ALIAS record. This is outside the
automated path.

### Security note

The Terraform `publisher_policy_json` output is a minimal IAM policy for
publishing. Prefer a dedicated IAM user (`create_publisher_user = true`) over
root credentials for day-to-day `hostdoc` use.

## Use with an agent (skill)

`hostdoc` ships an installable [agent skill](https://vercel.com/docs/agent-resources/skills)
so coding agents can drive it conversationally — "publish this folder", "list my
docs", "remove that slug" — without memorizing flags.

```bash
npx skills add jkas2016/hostdoc
```

This installs the `hostdoc` skill into your agent. The skill shells out to the
`hostdoc` CLI, preferring a global install and falling back to `npx -y hostdoc`,
so **no global install is required**. It runs an AWS-free preflight check and
turns missing config/credentials into guidance instead of raw errors.

Example prompts: *"publish ./report.html and give me the link"*, *"list my
published docs"*, *"open aws-design"*, *"remove aws-design"*.

## Credentials

`hostdoc` never stores AWS keys. It uses the AWS SDK default credential chain (environment variables → SSO → shared `~/.aws` profile). Select a profile with `--profile <name>` and a region with `--region <region>`.

## Configuration precedence

Flags (`--bucket/--region/...`) > `HOSTDOC_*` env vars > `~/.config/hostdoc/config.json`.

## License

MIT
