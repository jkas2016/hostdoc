import { terraform } from "../lib/terraform.js";
import { runInit } from "./init.js";
import type { Config } from "../lib/config.js";

/**
 * Provision the domain (CloudFront) infrastructure via Terraform, then import
 * its outputs into a cloudfront config. `terraform apply` streams its plan and
 * confirmation prompt; pass `approve` for non-interactive `-auto-approve`
 * (e.g. when hostdoc is driven by an agent).
 */
export function runProvision(args: { dir: string; approve?: boolean }): Config {
  // init is always non-interactive; the apply prompt is the human gate.
  terraform(args.dir, ["init", "-input=false"]);

  const applyArgs = ["apply"];
  if (args.approve) applyArgs.push("-auto-approve");
  terraform(args.dir, applyArgs);

  return runInit({ dir: args.dir });
}
