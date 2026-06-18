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

Note: no-domain mode serves content **publicly over HTTP** (S3 website endpoints do not support HTTPS). For public-facing HTTPS use the upcoming domain mode.

## Credentials

`hostdoc` never stores AWS keys. It uses the AWS SDK default credential chain (environment variables → SSO → shared `~/.aws` profile). Select a profile with `--profile <name>` and a region with `--region <region>`.

## Configuration precedence

Flags (`--bucket/--region/...`) > `HOSTDOC_*` env vars > `~/.config/hostdoc/config.json`.

## License

MIT
