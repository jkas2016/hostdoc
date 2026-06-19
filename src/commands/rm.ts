import { makeS3, listKeys, deleteKeys } from "../lib/aws.js";
import { resolveConfig, type Overrides } from "../lib/config.js";
import { metaKey } from "../lib/meta.js";
import { makeCloudFront, invalidate } from "../lib/cloudfront.js";

export async function runRm(
  args: { id: string; yes?: boolean } & Overrides & { profile?: string },
): Promise<void> {
  const cfg = resolveConfig(args);
  const s3 = makeS3({ region: cfg.region, profile: args.profile });

  const keys = await listKeys(s3, cfg.bucket, `${args.id}/`);
  if (keys.length === 0) {
    throw new Error(`Document not found: ${args.id}`);
  }
  await deleteKeys(s3, cfg.bucket, [...keys, metaKey(args.id)]);
  if (cfg.mode === "cloudfront" && cfg.distributionId) {
    const cf = makeCloudFront({ profile: args.profile });
    await invalidate(cf, cfg.distributionId, [`/${args.id}/*`]);
  }
}
