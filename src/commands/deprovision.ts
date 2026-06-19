import { terraform } from "../lib/terraform.js";

/**
 * Tear down the domain (CloudFront) infrastructure via Terraform. `terraform
 * destroy` streams its plan and confirmation prompt; pass `approve` for
 * non-interactive `-auto-approve` (e.g. when hostdoc is driven by an agent).
 */
export function runDeprovision(args: { dir: string; approve?: boolean }): void {
  // init is always non-interactive; the destroy prompt is the human gate.
  terraform(args.dir, ["init", "-input=false"]);

  const destroyArgs = ["destroy"];
  if (args.approve) destroyArgs.push("-auto-approve");
  terraform(args.dir, destroyArgs);
}
