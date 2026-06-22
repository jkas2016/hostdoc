import { terraform } from "../lib/terraform.js";
import { extractTemplates } from "../lib/templates.js";
import { ensureTfvars, type TfvarsFlags } from "../lib/tfvars.js";

/**
 * Tear down the domain (CloudFront) infrastructure via Terraform. Extracts the
 * bundled templates into `dir` when it has no `.tf`, and resolves
 * `terraform.tfvars` the same way as provision (Terraform's no-default
 * variables are required at plan time even for destroy). `terraform destroy`
 * streams its plan and confirmation prompt; pass `approve` for non-interactive
 * `-auto-approve` (e.g. when hostdoc is driven by an agent).
 */
export function runDeprovision(args: {
  dir: string;
  approve?: boolean;
  flags?: TfvarsFlags;
}): void {
  extractTemplates(args.dir);
  ensureTfvars(args.dir, args.flags ?? {});

  // init is always non-interactive; the destroy prompt is the human gate.
  terraform(args.dir, ["init", "-input=false"]);

  const destroyArgs = ["destroy"];
  if (args.approve) destroyArgs.push("-auto-approve");
  terraform(args.dir, destroyArgs);
}
