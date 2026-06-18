import { resolveConfig, type Overrides } from "../lib/config.js";

export function describeConfig(flags: Overrides): string {
  const cfg = resolveConfig(flags);
  const lines = [
    `mode: ${cfg.mode}`,
    `bucket: ${cfg.bucket}`,
    `region: ${cfg.region}`,
  ];
  if (cfg.mode === "s3-website") lines.push(`websiteEndpoint: ${cfg.websiteEndpoint}`);
  else lines.push(`domain: ${cfg.domain}`, `distributionId: ${cfg.distributionId}`);
  return lines.join("\n");
}
