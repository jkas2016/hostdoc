import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { websiteEndpoint } from "./url.js";

export type Mode = "s3-website" | "cloudfront";

export interface Config {
  mode: Mode;
  bucket: string;
  region: string;
  websiteEndpoint?: string; // s3-website
  distributionId?: string; // cloudfront
  domain?: string; // cloudfront
}

/** Per-field overrides accepted from CLI flags. */
export interface Overrides {
  bucket?: string;
  region?: string;
  domain?: string;
  distribution?: string;
}

export function configPath(): string {
  const base =
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "hostdoc", "config.json");
}

export function saveConfig(cfg: Config): void {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
}

export function loadConfig(): Config | null {
  const p = configPath();
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as Config;
}

/** Merge file < env < flags, then derive mode and required fields. */
export function resolveConfig(flags: Overrides): Config {
  const file = loadConfig();
  const bucket = flags.bucket ?? process.env.HOSTDOC_BUCKET ?? file?.bucket;
  const region = flags.region ?? process.env.HOSTDOC_REGION ?? file?.region;
  const domain = flags.domain ?? process.env.HOSTDOC_DOMAIN ?? file?.domain;
  const distributionId =
    flags.distribution ??
    process.env.HOSTDOC_DISTRIBUTION ??
    file?.distributionId;

  if (domain && distributionId) {
    if (!bucket || !region) {
      throw new Error(
        "Incomplete cloudfront config: bucket and region are required. Run `hostdoc init --from-terraform <dir>`.",
      );
    }
    return { mode: "cloudfront", bucket, region, domain, distributionId };
  }

  if (bucket && region) {
    return {
      mode: "s3-website",
      bucket,
      region,
      websiteEndpoint: file?.websiteEndpoint ?? websiteEndpoint(bucket, region),
    };
  }

  throw new Error(
    "No configuration found. Run `hostdoc setup` to create infrastructure, or set --bucket/--region (or HOSTDOC_BUCKET/HOSTDOC_REGION).",
  );
}
