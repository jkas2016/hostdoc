#!/usr/bin/env node
// Thin wrapper around the hostdoc CLI: resolve a runner, pass args through,
// stream output live, and turn known failures into actionable guidance.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

export function onPath(name, env = process.env) {
  const exts = process.platform === "win32" ? [name, `${name}.cmd`, `${name}.exe`] : [name];
  return (env.PATH || "")
    .split(delimiter)
    .filter(Boolean)
    .some((dir) => exts.some((e) => existsSync(join(dir, e))));
}

export function resolveRunner(env = process.env) {
  if (env.HOSTDOC_BIN) return env.HOSTDOC_BIN.split(/\s+/).filter(Boolean);
  if (onPath("hostdoc", env)) return ["hostdoc"];
  return ["npx", "-y", "hostdoc"];
}

const RULES = [
  [/CredentialsProviderError|session expired|ExpiredToken|reauthenticate|could not load credentials/i,
    "AWS credentials are missing or expired. Provide them via env vars, --profile, or re-run your SSO login, then retry."],
  [/no config|No configuration|config not found|run [`']?hostdoc setup/i,
    "No hostdoc config found. Run `setup` for an HTTP S3-website bucket, or `provision` for an HTTPS custom domain."],
  [/NoSuchBucket/i,
    "The configured bucket does not exist. Run `setup` to create it, or correct the bucket in your config."],
  [/already exists/i,
    "That slug is already taken. Re-run with --force to overwrite, or choose a different --slug."],
  [/Throttl|Rate exceeded|SlowDown/i,
    "AWS throttled the request (hostdoc retries with backoff). Wait a moment and retry if it persists."],
];

export function classifyError(stderr) {
  for (const [re, msg] of RULES) if (re.test(stderr)) return msg;
  return null;
}

function main(argv) {
  const [cmd, ...prefix] = resolveRunner();
  const child = spawn(cmd, [...prefix, ...argv], { stdio: ["inherit", "inherit", "pipe"] });
  let err = "";
  child.stderr.on("data", (d) => {
    err += d;
    process.stderr.write(d);
  });
  child.on("error", (e) => {
    process.stderr.write(`hostdoc-skill: could not launch the hostdoc CLI: ${e.message}\n`);
    process.exit(127);
  });
  child.on("close", (code) => {
    if (code !== 0) {
      const hint = classifyError(err);
      if (hint) process.stderr.write(`\nhostdoc-skill: ${hint}\n`);
    }
    process.exit(code ?? 1);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
