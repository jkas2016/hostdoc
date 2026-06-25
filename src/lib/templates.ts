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

/** First dir in `dirs` that exists; falls back to the last entry when none do. */
export function firstExistingDir(
  dirs: string[],
  exists: (d: string) => boolean = existsSync,
): string {
  return dirs.find((d) => exists(d)) ?? dirs[dirs.length - 1];
}

/**
 * Path to the bundled templates. Prefers dist/templates/infra/ (shipped in the
 * npm package); from source (npm run dev) that dir is absent, so fall back to the
 * repo's infra/.
 */
export function bundledTemplatesDir(): string {
  const bundled = fileURLToPath(new URL("../templates/infra/", import.meta.url));
  const repoInfra = fileURLToPath(new URL("../../infra/", import.meta.url));
  return firstExistingDir([bundled, repoInfra]);
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
