import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Files copied from infra/ into the package by scripts/copy-templates.mjs. */
export const TEMPLATE_FILES = [
  "main.tf",
  "variables.tf",
  "outputs.tf",
  "index-rewrite.js",
  "terraform.tfvars.example",
  ".terraform.lock.hcl",
] as const;

/** Path to the bundled templates shipped under dist/templates/infra/. */
export function bundledTemplatesDir(): string {
  // dist/lib/templates.js -> dist/templates/infra
  return fileURLToPath(new URL("../templates/infra/", import.meta.url));
}

/** Whether <dir> already contains any Terraform (*.tf) files. */
export function hasTfFiles(dir: string): boolean {
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((f) => f.endsWith(".tf"));
}

/**
 * Extract the bundled Terraform templates into <destDir>. No-op when <destDir>
 * already has .tf files (never clobber a user's edited infra). Returns whether
 * files were written.
 */
export function extractTemplates(
  destDir: string,
  srcDir: string = bundledTemplatesDir(),
): { extracted: boolean } {
  if (hasTfFiles(destDir)) return { extracted: false };
  mkdirSync(destDir, { recursive: true });
  for (const f of TEMPLATE_FILES) {
    copyFileSync(join(srcDir, f), join(destDir, f));
  }
  return { extracted: true };
}
