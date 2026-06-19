import { execFileSync } from "node:child_process";

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
