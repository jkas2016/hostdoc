import type { Config } from "./config.js";

// Regions that use the dash-style website endpoint (s3-website-<region>).
// All others use dot-style (s3-website.<region>). See AWS S3 Website Endpoints docs.
const DASH_REGIONS = new Set([
  "us-east-1",
  "us-west-1",
  "us-west-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "eu-west-1",
  "sa-east-1",
]);

export function websiteEndpoint(bucket: string, region: string): string {
  const host = DASH_REGIONS.has(region)
    ? `${bucket}.s3-website-${region}.amazonaws.com`
    : `${bucket}.s3-website.${region}.amazonaws.com`;
  return `http://${host}`;
}

export function buildPublicUrl(cfg: Config, code: string): string {
  if (cfg.mode === "cloudfront") {
    return `https://${cfg.domain}/${code}/`;
  }
  return `${cfg.websiteEndpoint}/${code}/`;
}
