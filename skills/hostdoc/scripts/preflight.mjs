#!/usr/bin/env node
// AWS-free readiness checks: is hostdoc configured, and are AWS credentials
// likely available? Prints actionable guidance instead of letting a command
// fail deep with a raw error.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRunner } from "./run.mjs";

export function credsPresent(env = process.env, home = homedir()) {
  if (env.AWS_ACCESS_KEY_ID || env.AWS_PROFILE || env.AWS_SESSION_TOKEN) return true;
  return existsSync(join(home, ".aws", "credentials")) || existsSync(join(home, ".aws", "config"));
}

export function configPresent(env = process.env) {
  const [cmd, ...prefix] = resolveRunner(env);
  const res = spawnSync(cmd, [...prefix, "config"], { encoding: "utf8", env });
  return res.status === 0 && /mode:/.test(res.stdout || "");
}

function main() {
  const problems = [];
  if (!configPresent())
    problems.push("No hostdoc config found. Run `setup` (HTTP S3-website) or `provision` (HTTPS custom domain) first.");
  if (!credsPresent())
    problems.push("No AWS credentials detected. Provide them via env vars, --profile, or SSO before publishing.");
  if (problems.length) {
    for (const p of problems) process.stderr.write(`hostdoc-skill: ${p}\n`);
    process.exit(1);
  }
  process.stdout.write("hostdoc-skill: ready\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
