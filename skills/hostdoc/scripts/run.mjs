#!/usr/bin/env node
// Thin wrapper around the hostdoc CLI: resolve a runner, pass args through,
// stream output live, and turn known failures into actionable guidance.
import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants, statSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

function isExecutableFile(p) {
  try {
    if (!statSync(p).isFile()) return false;
    if (process.platform === "win32") return true; // ext-based; X_OK is unreliable
    accessSync(p, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function onPath(name, env = process.env) {
  const exts = process.platform === "win32" ? [name, `${name}.cmd`, `${name}.exe`] : [name];
  return (env.PATH || "")
    .split(delimiter)
    .filter(Boolean)
    .some((dir) => exts.some((e) => isExecutableFile(join(dir, e))));
}

/** Split a command line into argv, honoring "double" and 'single' quotes so a
 * path containing spaces survives as a single token. */
export function splitCommand(s) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s)) !== null) tokens.push(m[1] ?? m[2] ?? m[3]);
  return tokens;
}

export function resolveRunner(env = process.env) {
  if (env.HOSTDOC_BIN) return splitCommand(env.HOSTDOC_BIN);
  if (onPath("hostdoc", env)) return ["hostdoc"];
  return ["npx", "-y", "hostdoc"];
}

/** Append `chunk` to `buf`, keeping at most the last `cap` characters. */
export function clampTail(buf, chunk, cap = 65536) {
  const next = buf + chunk;
  return next.length > cap ? next.slice(next.length - cap) : next;
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
  let errTail = "";
  child.stderr.on("data", (d) => {
    errTail = clampTail(errTail, d.toString());
    process.stderr.write(d);
  });
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => child.kill(sig));
  }
  child.on("error", (e) => {
    process.stderr.write(`hostdoc-skill: could not launch the hostdoc CLI: ${e.message}\n`);
    process.exit(127);
  });
  child.on("close", (code, signal) => {
    if (code !== 0) {
      const hint = classifyError(errTail);
      if (hint) process.stderr.write(`\nhostdoc-skill: ${hint}\n`);
    }
    if (signal) process.exit(128 + (osConstants.signals[signal] ?? 0));
    process.exit(code ?? 1);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
