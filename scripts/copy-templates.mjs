// Copies the variable-only Terraform templates from infra/ into
// dist/templates/infra/ so they ship in the npm tarball (files: ["dist"]).
// Allowlist, never a denylist: a *.tfstate or terraform.tfvars can never be
// copied even if it appears in infra/.
import { mkdirSync, copyFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// Single source of truth: `tsc` runs before this script (npm run build), so the
// compiled allowlist exists in dist/. Re-declaring it here would risk drift.
import { TEMPLATE_FILES } from "../dist/lib/templates.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "infra");
const DEST = join(ROOT, "dist", "templates", "infra");

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
for (const f of TEMPLATE_FILES) {
  copyFileSync(join(SRC, f), join(DEST, f));
}
console.log(`Copied ${TEMPLATE_FILES.length} template files to dist/templates/infra/`);
