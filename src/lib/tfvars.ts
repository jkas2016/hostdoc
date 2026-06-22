import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface TfvarsFlags {
  hostedZone?: string;
  subdomain?: string;
  region?: string;
  priceClass?: string;
}

const TFVARS = "terraform.tfvars";

export function tfvarsPath(dir: string): string {
  return join(dir, TFVARS);
}

export function hasTfvars(dir: string): boolean {
  return existsSync(tfvarsPath(dir));
}

/** HCL string literal: escape backslash and double-quote. */
function hcl(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Write terraform.tfvars in <dir>. price_class is only emitted when provided
 * (Terraform supplies its own default otherwise).
 */
export function writeTfvars(
  dir: string,
  vars: { hostedZone: string; subdomain: string; region: string; priceClass?: string },
): void {
  const lines = [
    `hosted_zone_name = ${hcl(vars.hostedZone)}`,
    `subdomain        = ${hcl(vars.subdomain)}`,
    `aws_region       = ${hcl(vars.region)}`,
  ];
  if (vars.priceClass) lines.push(`price_class      = ${hcl(vars.priceClass)}`);
  writeFileSync(tfvarsPath(dir), lines.join("\n") + "\n");
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
