import type { Upload } from "./walk.js";

export interface Meta {
  code: string;
  slug: string | null;
  title: string | null;
  createdAt: string; // ISO 8601
  files: number;
  bytes: number;
  sourcePath: string;
}

export function metaKey(code: string): string {
  return `_meta/${code}.json`;
}

export function nestedMetaPrefix(code: string): string {
  return `_meta/${code}/`; // code 아래 사는 모든 문서의 사이드카 prefix
}

/** Runtime guard: sidecar JSON has the fields list relies on (code + createdAt). */
export function isValidMeta(v: unknown): v is Meta {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  return typeof m.code === "string" && typeof m.createdAt === "string";
}

export function extractTitle(html: string): string | null {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : null;
}

export function buildMeta(args: {
  code: string;
  slug: string | null;
  title: string | null;
  uploads: Upload[];
  sourcePath: string;
}): Meta {
  return {
    code: args.code,
    slug: args.slug,
    title: args.title,
    createdAt: new Date().toISOString(),
    files: args.uploads.length,
    bytes: args.uploads.reduce((sum, u) => sum + u.size, 0),
    sourcePath: args.sourcePath,
  };
}
