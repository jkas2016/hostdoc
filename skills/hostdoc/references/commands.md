# hostdoc command reference

All commands run as `node <skill>/scripts/run.mjs <command> [args…]`.

## Config precedence & credentials

- Precedence: CLI flags > `HOSTDOC_*` env > `~/.config/hostdoc/config.json`.
- Common overrides (most commands): `--profile <name>`, `--region <region>`,
  `--bucket <name>`, `--domain <domain>`, `--distribution <id>`.
- Credentials use the AWS SDK default chain (env vars, shared profile via
  `--profile`, or SSO). The skill never stores or forwards credentials.

## Commands

| Command | Purpose | Key flags |
| --- | --- | --- |
| `publish <path>` | Upload a file/folder; prints the public URL | `--slug <name>`, `--title <t>`, `--force`, `--open`, `--dry-run` |
| `list` | List published documents | common overrides |
| `open <id>` | Print/open a doc's URL | common overrides |
| `rm <id>` | Delete a doc by code or slug | `--yes` (skip confirm) |
| `config` | Show the active configuration (AWS-free) | common overrides |
| `setup` | Create a public S3-website bucket + save config | `--bucket <name>` (req), `--region <r>` (req), `--profile <name>` |
| `provision` | Provision HTTPS/CloudFront via Terraform | `--hosted-zone <z>`, `--subdomain <s>`, `--region <r>`, `--price-class <c>`, `--dir <d>`, `--approve` |
| `deprovision` | Tear down the domain infra | `--hosted-zone <z>`, `--subdomain <s>`, `--region <r>`, `--dir <d>`, `--approve` |
| `init --from-terraform <dir>` | Import existing Terraform outputs into a cloudfront config | — |

## Agent / non-interactive notes

- `provision` and `deprovision` prompt for Terraform approval unless `--approve`
  is passed — always pass `--approve` when driving non-interactively.
- `rm` prompts unless `--yes` is passed.
- `provision` is long-running (~15–30 min); its output streams live through the
  wrapper.

> Note: `publish --dry-run` currently still makes an AWS call to check slug/code
> availability, so it needs valid credentials. (Tracked as a separate CLI
> follow-up to make dry-run fully offline.)
