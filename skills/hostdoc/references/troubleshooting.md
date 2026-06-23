# hostdoc troubleshooting

The wrapper (`run.mjs`) appends a `hostdoc-skill:` guidance line for known
failures. Mapping:

| Symptom (in stderr) | Guidance |
| --- | --- |
| `CredentialsProviderError`, `session expired`, `ExpiredToken`, "could not load credentials" | Credentials missing/expired — set env vars, pass `--profile`, or re-run SSO login, then retry. |
| "No config" / "No configuration" / "run `hostdoc setup`" | Not configured — run `setup` (HTTP S3-website) or `provision` (HTTPS custom domain). |
| `NoSuchBucket` | Configured bucket doesn't exist — run `setup` or fix the bucket in config. |
| "already exists" (slug) | Slug taken — re-run with `--force` or pick a different `--slug`. |
| `Throttling`, `Rate exceeded`, `SlowDown` | AWS throttled; hostdoc retries with backoff — wait and retry. |

## Preflight

Run `node <skill>/scripts/preflight.mjs` before AWS-touching commands. It checks:

- **Config present** — via the AWS-free `config` command.
- **Credentials likely present** — `AWS_ACCESS_KEY_ID` / `AWS_PROFILE` /
  `AWS_SESSION_TOKEN` env, or `~/.aws/{credentials,config}`.

It does not validate credentials against AWS (no STS call), so an expired token
still surfaces at run time — handled by the reactive mapping above.

## CLI not found

If neither a global `hostdoc` nor `npx` can run it, the wrapper prints
"could not launch the hostdoc CLI". Ensure Node ≥22.12 and network access for the
first `npx -y hostdoc`, or install globally with `npm i -g hostdoc`.
