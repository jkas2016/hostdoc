// Copies the variable-only Terraform templates from infra/ into
// dist/templates/infra/ so they ship in the npm tarball (files: ["dist"]).
// Allowlist, never a denylist: a *.tfstate or terraform.tfvars can never be
// copied even if it appears in infra/.
import { mkdirSync, copyFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "infra");
const DEST = join(ROOT, "dist", "templates", "infra");

const FILES = [
  "main.tf",
  "variables.tf",
  "outputs.tf",
  "index-rewrite.js",
  "terraform.tfvars.example",
  ".terraform.lock.hcl",
];

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
for (const f of FILES) {
  copyFileSync(join(SRC, f), join(DEST, f));
}
console.log(`Copied ${FILES.length} template files to dist/templates/infra/`);
