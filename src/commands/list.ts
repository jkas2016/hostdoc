import { makeS3, listKeys, getJson } from "../lib/aws.js";
import { resolveConfig, type Overrides } from "../lib/config.js";
import { buildPublicUrl } from "../lib/url.js";
import type { Meta } from "../lib/meta.js";

export interface DocRow extends Meta {
  url: string;
}

export async function listDocs(
  flags: Overrides & { profile?: string },
): Promise<DocRow[]> {
  const cfg = resolveConfig(flags);
  const s3 = makeS3({ region: cfg.region, profile: flags.profile });
  const keys = await listKeys(s3, cfg.bucket, "_meta/");

  const rows: DocRow[] = [];
  for (const key of keys) {
    const meta = await getJson<Meta>(s3, cfg.bucket, key);
    rows.push({ ...meta, url: buildPublicUrl(cfg, meta.code) });
  }
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return rows;
}

export function formatRows(rows: DocRow[]): string {
  if (rows.length === 0) return "No documents published yet.";
  return rows
    .map(
      (r) =>
        `${r.code}\t${r.slug ?? "-"}\t${r.title ?? "-"}\t${r.createdAt}\t${r.url}`,
    )
    .join("\n");
}
