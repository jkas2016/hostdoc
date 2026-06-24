import { makeS3, listKeys, getJson } from "../lib/aws.js";
import { resolveConfig, type Overrides } from "../lib/config.js";
import { buildPublicUrl } from "../lib/url.js";
import { isValidMeta, type Meta } from "../lib/meta.js";

export interface DocRow extends Meta {
  url: string;
}

export async function listDocs(
  flags: Overrides & { profile?: string },
): Promise<DocRow[]> {
  const cfg = resolveConfig(flags);
  const s3 = makeS3({ region: cfg.region, profile: flags.profile });
  const keys = await listKeys(s3, cfg.bucket, "_meta/");

  // Fetch sidecars in parallel; a corrupt/missing one is skipped, not fatal.
  const settled = await Promise.all(
    keys.map(async (key): Promise<DocRow | null> => {
      try {
        const meta = await getJson<unknown>(s3, cfg.bucket, key);
        if (!isValidMeta(meta)) {
          console.warn(`Skipping ${key}: not a valid document sidecar.`);
          return null;
        }
        return { ...meta, url: buildPublicUrl(cfg, meta.code) };
      } catch (err) {
        console.warn(`Skipping ${key}: ${(err as Error).message}`);
        return null;
      }
    }),
  );

  const rows = settled.filter((r): r is DocRow => r !== null);
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
