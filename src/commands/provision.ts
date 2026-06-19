import { execFileSync } from "node:child_process";
import { runInit } from "./init.js";
import type { Config } from "../lib/config.js";

/**
 * Provision the domain (CloudFront) infrastructure via Terraform, then import
 * its outputs into a cloudfront config. `terraform apply` streams its plan and
 * confirmation prompt to the terminal; pass `approve` for non-interactive
 * `-auto-approve` (e.g. when hostdoc is driven by an agent).
 */
export function runProvision(args: { dir: string; approve?: boolean }): Config {
  execFileSync("terraform", [`-chdir=${args.dir}`, "init", "-input=false"], {
    stdio: "inherit",
  });

  const applyArgs = [`-chdir=${args.dir}`, "apply"];
  if (args.approve) applyArgs.push("-auto-approve");
  execFileSync("terraform", applyArgs, { stdio: "inherit" });

  return runInit({ dir: args.dir });
}
