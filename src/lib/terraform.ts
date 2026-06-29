import { execFileSync } from "node:child_process";
import { extractTemplates } from "./templates.js";
import { ensureTfvars, type TfvarsFlags } from "./tfvars.js";

/**
 * Run a terraform subcommand in <dir>, streaming its stdio (so terraform's
 * plan and confirmation prompt reach the user). Converts a missing-binary
 * error into a clear install hint.
 */
export function terraform(dir: string, args: string[]): void {
  try {
    execFileSync("terraform", [`-chdir=${dir}`, ...args], { stdio: "inherit" });
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") {
      throw new Error(
        "terraform is not installed or not on PATH. Install it (e.g. `brew install terraform`) and retry.",
      );
    }
    throw err;
  }
}

/**
 * Shared provision/deprovision preamble: extract the bundled templates into
 * `dir` (no-op when it already has `.tf`), resolve `terraform.tfvars` from
 * `flags`, and run a non-interactive `init`. The subsequent apply/destroy is
 * the caller's human gate.
 */
export function prepareInfra(dir: string, flags?: TfvarsFlags): void {
  extractTemplates(dir);
  ensureTfvars(dir, flags ?? {});
  terraform(dir, ["init", "-input=false"]);
}

/** terraform subcommand args, appending `-auto-approve` only when approved. */
export function approvable(cmd: string, approve?: boolean): string[] {
  return approve ? [cmd, "-auto-approve"] : [cmd];
}
