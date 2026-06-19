# hostdoc

Publish a local HTML file or folder to **your own AWS** and get a short shareable link.

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

Note: no-domain mode serves content **publicly over HTTP** (S3 website endpoints do not support HTTPS). For public-facing HTTPS, see [Domain mode](#domain-mode-https-via-cloudfront) below.

## Domain mode (HTTPS via CloudFront)

Domain mode serves your docs over HTTPS from a fully private S3 bucket fronted
by CloudFront (OAC). It is provisioned with Terraform.

**Prerequisites:** a Route53 hosted zone for your domain, AWS credentials, and
Terraform installed.

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: hosted_zone_name, subdomain, aws_region
cd ..

hostdoc provision            # runs terraform init + apply, then writes the config (~15-30 min)
# non-interactive (e.g. driving hostdoc from an agent):
#   hostdoc provision --approve
hostdoc publish ./mydoc      # → https://<subdomain>.<domain>/<code>/
```

Already provisioned the infra yourself? Import it without applying:
`hostdoc init --from-terraform ./infra`.

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

## Credentials

`hostdoc` never stores AWS keys. It uses the AWS SDK default credential chain (environment variables → SSO → shared `~/.aws` profile). Select a profile with `--profile <name>` and a region with `--region <region>`.

## Configuration precedence

Flags (`--bucket/--region/...`) > `HOSTDOC_*` env vars > `~/.config/hostdoc/config.json`.

## License

MIT
