import { makeS3, listKeys, deleteKeys } from "../lib/aws.js";
import { resolveConfig, type Overrides } from "../lib/config.js";
import { metaKey, nestedMetaPrefix } from "../lib/meta.js";
import { makeCloudFront, invalidate } from "../lib/cloudfront.js";
import { isValidPath, isValidCode } from "../lib/code.js";
import { confirm } from "../lib/prompt.js";

export async function runRm(
  args: { id: string; yes?: boolean } & Overrides & { profile?: string },
): Promise<void> {
  if (!isValidPath(args.id) && !isValidCode(args.id)) {
    throw new Error(`Invalid id: ${args.id}`);
  }
  if (!args.yes && !process.stdin.isTTY) {
    throw new Error(
      `Refusing to delete "${args.id}" without confirmation; re-run with --yes.`,
    );
  }

  const cfg = resolveConfig(args);
  const s3 = makeS3({ region: cfg.region, profile: args.profile });

  const keys = await listKeys(s3, cfg.bucket, `${args.id}/`);
  if (keys.length === 0) {
    throw new Error(`Document not found: ${args.id}`);
  }

  if (!args.yes) {
    const ok = await confirm(
      `Delete "${args.id}" (${keys.length} file(s))? [y/N] `,
    );
    if (!ok) throw new Error("Aborted.");
  }

  const nestedMeta = await listKeys(s3, cfg.bucket, nestedMetaPrefix(args.id));
  await deleteKeys(s3, cfg.bucket, [...keys, metaKey(args.id), ...nestedMeta]);
  if (cfg.mode === "cloudfront" && cfg.distributionId) {
    const cf = makeCloudFront({ profile: args.profile });
    await invalidate(cf, cfg.distributionId, [`/${args.id}/*`]);
  }
}
