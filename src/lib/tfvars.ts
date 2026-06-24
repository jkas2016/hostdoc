import { existsSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface TfvarsFlags {
  hostedZone?: string;
  subdomain?: string;
  region?: string;
  priceClass?: string;
}

const TFVARS = "terraform.tfvars.json";
const LEGACY_TFVARS = "terraform.tfvars";

export function tfvarsPath(dir: string): string {
  return join(dir, TFVARS);
}

/** True if a tool-written terraform.tfvars.json or a legacy terraform.tfvars exists. */
export function hasTfvars(dir: string): boolean {
  return existsSync(tfvarsPath(dir)) || existsSync(join(dir, LEGACY_TFVARS));
}

/**
 * Write terraform.tfvars.json in <dir>. Values are JSON-encoded, so user input is
 * always literal — JSON has no HCL template interpolation, closing the
 * ${...}/%{...} injection vector. price_class is only emitted when provided
 * (Terraform supplies its own default otherwise). A legacy plain terraform.tfvars
 * is removed so flags win cleanly (Terraform would otherwise still load it, with
 * terraform.tfvars.json taking precedence per-key but leaving stale keys behind).
 */
export function writeTfvars(
  dir: string,
  vars: { hostedZone: string; subdomain: string; region: string; priceClass?: string },
): void {
  const obj: Record<string, string> = {
    hosted_zone_name: vars.hostedZone,
    subdomain: vars.subdomain,
    aws_region: vars.region,
  };
  if (vars.priceClass) obj.price_class = vars.priceClass;
  writeFileSync(tfvarsPath(dir), JSON.stringify(obj, null, 2) + "\n");
  rmSync(join(dir, LEGACY_TFVARS), { force: true });
}

/**
 * Resolve terraform.tfvars for provision/deprovision: flags win, an existing
 * tfvars is a cache.
 *  - all three required flags present  -> write (overwriting any existing)
 *  - some but not all required present -> throw, naming the missing flags
 *  - none present + existing tfvars    -> use it (no-op)
 *  - none present + no tfvars          -> throw with guidance
 */
export function ensureTfvars(dir: string, flags: TfvarsFlags): void {
  const required: Record<string, string | undefined> = {
    "--hosted-zone": flags.hostedZone,
    "--subdomain": flags.subdomain,
    "--region": flags.region,
  };
  const present = Object.values(required).filter(Boolean).length;
  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (present === 3) {
    writeTfvars(dir, {
      hostedZone: flags.hostedZone!,
      subdomain: flags.subdomain!,
      region: flags.region!,
      priceClass: flags.priceClass,
    });
    return;
  }
  if (present > 0) {
    throw new Error(
      `Missing required flag(s): ${missing.join(", ")} ` +
        `(provide all of --hosted-zone, --subdomain, --region together).`,
    );
  }
  if (hasTfvars(dir)) return;
  throw new Error(
    `No terraform.tfvars in "${dir}". Pass --hosted-zone <zone> --subdomain <sub> ` +
      `--region <region> (or create ${TFVARS} yourself).`,
  );
}
