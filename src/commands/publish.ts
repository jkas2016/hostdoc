import { readFile } from "node:fs/promises";
import { makeS3, putObject, listKeys, existsPrefix, deleteKeys } from "../lib/aws.js";
import { resolveConfig } from "../lib/config.js";
import { generateCode, isValidPath } from "../lib/code.js";
import { collectUploads, type Upload } from "../lib/walk.js";
import { buildMeta, metaKey, nestedMetaPrefix, extractTitle } from "../lib/meta.js";
import { buildPublicUrl } from "../lib/url.js";
import { makeCloudFront, invalidate } from "../lib/cloudfront.js";
import { mapLimit } from "../lib/concurrency.js";
import type { S3Client } from "@aws-sdk/client-s3";

const UPLOAD_CONCURRENCY = 8;

export interface PublishArgs {
  path: string;
  slug?: string;
  title?: string;
  force?: boolean;
  dryRun?: boolean;
  region?: string;
  profile?: string;
  bucket?: string;
  domain?: string;
  distribution?: string;
}

async function uniqueCode(s3: S3Client, bucket: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = generateCode();
    if (!(await existsPrefix(s3, bucket, `${code}/`))) return code;
  }
  throw new Error("Could not generate a unique code after 5 attempts.");
}

async function deriveTitle(uploads: Upload[]): Promise<string | null> {
  const entry = uploads.find((u) => u.key === "index.html");
  if (!entry) return null;
  return extractTitle(await readFile(entry.absPath, "utf8"));
}

export async function runPublish(args: PublishArgs): Promise<string> {
  const cfg = resolveConfig({
    bucket: args.bucket,
    region: args.region,
    domain: args.domain,
    distribution: args.distribution,
  });
  const s3 = makeS3({ region: cfg.region, profile: args.profile });
  const uploads = await collectUploads(args.path);

  let code: string;
  if (args.slug) {
    if (!isValidPath(args.slug)) {
      throw new Error(
        `Invalid slug "${args.slug}". Use lowercase letters, digits, and hyphens per path segment (each segment must start alphanumeric); "/" separates nested segments.`,
      );
    }
    if (!args.dryRun) {
      const exists = await existsPrefix(s3, cfg.bucket, `${args.slug}/`);
      if (exists && !args.force) {
        throw new Error(`Slug "${args.slug}" already exists. Use --force to overwrite.`);
      }
    }
    code = args.slug;
  } else {
    code = args.dryRun ? generateCode() : await uniqueCode(s3, cfg.bucket);
  }

  if (args.dryRun) {
    return buildPublicUrl(cfg, code);
  }

  let overwritten = false;
  if (args.force) {
    const existing = await listKeys(s3, cfg.bucket, `${code}/`);
    if (existing.length) {
      const nestedMeta = await listKeys(s3, cfg.bucket, nestedMetaPrefix(code));
      await deleteKeys(s3, cfg.bucket, [...existing, ...nestedMeta]);
      overwritten = true;
    }
  }

  await mapLimit(uploads, UPLOAD_CONCURRENCY, async (u) => {
    await putObject(
      s3,
      cfg.bucket,
      `${code}/${u.key}`,
      await readFile(u.absPath),
      u.contentType,
    );
  });

  const title = args.title ?? (await deriveTitle(uploads));
  const meta = buildMeta({
    code,
    slug: args.slug ?? null,
    title,
    uploads,
    sourcePath: args.path,
  });
  await putObject(
    s3,
    cfg.bucket,
    metaKey(code),
    Buffer.from(JSON.stringify(meta, null, 2)),
    "application/json",
  );

  if (cfg.mode === "cloudfront" && cfg.distributionId && overwritten) {
    const cf = makeCloudFront({ profile: args.profile });
    await invalidate(cf, cfg.distributionId, [`/${code}/*`]);
  }

  return buildPublicUrl(cfg, code);
}
