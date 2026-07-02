import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Read the version straight from package.json — the CLI must report exactly this.
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

// Run the CLI from source (same entry as `npm run dev`) and capture stdout.
function cliVersion(flag: string): string {
  return execFileSync(process.execPath, ["--import", "tsx", "src/index.ts", flag], {
    encoding: "utf8",
  }).trim();
}

describe("hostdoc --version", () => {
  it("prints the package.json version", () => {
    expect(cliVersion("--version")).toBe(pkg.version);
  });

  it("prints the same version via -v", () => {
    expect(cliVersion("-v")).toBe(pkg.version);
  });
});
