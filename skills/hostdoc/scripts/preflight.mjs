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

/** Classify a `config` probe result: "unknown" when the runner could not be
 * launched or was killed (e.g. an npx cold-start timeout), so a slow launch is
 * not misreported as "no config". */
export function classifyConfigProbe(res) {
  if (res.error || res.signal || res.status === null) return "unknown";
  return res.status === 0 && /mode:/.test(res.stdout || "") ? "present" : "absent";
}

export function configState(env = process.env) {
  const [cmd, ...prefix] = resolveRunner(env);
  const res = spawnSync(cmd, [...prefix, "config"], { encoding: "utf8", env, timeout: 60000 });
  return classifyConfigProbe(res);
}

function main() {
  const problems = [];
  const cfg = configState();
  if (cfg === "absent")
    problems.push("No hostdoc config found. Run `setup` (HTTP S3-website) or `provision` (HTTPS custom domain) first.");
  else if (cfg === "unknown")
    problems.push("Could not verify hostdoc config (the CLI was slow to start, e.g. a cold `npx` download). Ensure a config exists or set HOSTDOC_BIN, then retry.");
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
