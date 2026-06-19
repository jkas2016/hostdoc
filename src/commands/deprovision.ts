import { execFileSync } from "node:child_process";

/**
 * Tear down the domain (CloudFront) infrastructure via Terraform. `terraform
 * destroy` streams its plan and confirmation prompt to the terminal; pass
 * `approve` for non-interactive `-auto-approve` (e.g. when hostdoc is driven
 * by an agent).
 */
export function runDeprovision(args: { dir: string; approve?: boolean }): void {
  execFileSync("terraform", [`-chdir=${args.dir}`, "init", "-input=false"], {
    stdio: "inherit",
  });

  const destroyArgs = [`-chdir=${args.dir}`, "destroy"];
  if (args.approve) destroyArgs.push("-auto-approve");
  execFileSync("terraform", destroyArgs, { stdio: "inherit" });
}
