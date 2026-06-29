import { terraform, prepareInfra, approvable } from "../lib/terraform.js";
import type { TfvarsFlags } from "../lib/tfvars.js";
import { runInit } from "./init.js";
import type { Config } from "../lib/config.js";

/**
 * Provision the domain (CloudFront) infrastructure via Terraform, then import
 * its outputs into a cloudfront config. Extracts the bundled templates into
 * `dir` when it has no `.tf`, and writes `terraform.tfvars` from `flags`
 * (flags win; an existing tfvars is reused when no flags are given).
 * `terraform apply` streams its plan and confirmation prompt; pass `approve`
 * for non-interactive `-auto-approve` (e.g. when hostdoc is driven by an agent).
 */
export function runProvision(args: {
  dir: string;
  approve?: boolean;
  flags?: TfvarsFlags;
}): Config {
  // init is always non-interactive; the apply prompt is the human gate.
  prepareInfra(args.dir, args.flags);
  terraform(args.dir, approvable("apply", args.approve));
  return runInit({ dir: args.dir });
}
