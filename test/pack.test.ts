import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { TEMPLATE_FILES } from "../src/lib/templates.js";

// Assumes `npm run build` has run (CI order is build→typecheck→test), so
// dist/templates/infra exists. --ignore-scripts packs the current dist as-is.
function packedFiles(): string[] {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    encoding: "utf8",
  });
  const parsed = JSON.parse(out) as Array<{ files: Array<{ path: string }> }>;
  return parsed[0].files.map((f) => f.path);
}

describe("npm pack tarball", () => {
  it("ships the variable-only templates", () => {
    const files = packedFiles();
    for (const f of [
      "dist/templates/infra/main.tf",
      "dist/templates/infra/variables.tf",
      "dist/templates/infra/outputs.tf",
      "dist/templates/infra/index-rewrite.js",
      "dist/templates/infra/terraform.tfvars.example",
      "dist/templates/infra/.terraform.lock.hcl",
    ]) {
      expect(files).toContain(f);
    }
  });

  it("never ships state or real tfvars", () => {
    const files = packedFiles();
    expect(files.some((p) => p.includes(".tfstate"))).toBe(false);
    expect(files.some((p) => /(^|\/)terraform\.tfvars(\.json)?$/.test(p))).toBe(false);
  });

  it("ships exactly the TEMPLATE_FILES allowlist (no drift, no extras)", () => {
    const packed = packedFiles()
      .filter((p) => p.startsWith("dist/templates/infra/"))
      .map((p) => p.slice("dist/templates/infra/".length));
    expect([...packed].sort()).toEqual([...TEMPLATE_FILES].sort());
  });
});
