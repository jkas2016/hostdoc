import { readdir, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { contentTypeFor } from "./mime.js";

export interface Upload {
  key: string; // relative key under <code>/, posix separators
  absPath: string;
  contentType: string;
  size: number;
}

async function walkDir(root: string, current: string): Promise<Upload[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (e): Promise<Upload[]> => {
      const abs = join(current, e.name);
      if (e.isDirectory()) return walkDir(root, abs);
      if (e.isFile()) {
        const s = await stat(abs);
        return [
          {
            key: relative(root, abs).split(sep).join("/"),
            absPath: abs,
            contentType: contentTypeFor(e.name),
            size: s.size,
          },
        ];
      }
      return [];
    }),
  );
  return nested.flat();
}

/** Single file → index.html; directory → recursive tree under the same prefix. */
export async function collectUploads(inputPath: string): Promise<Upload[]> {
  let info;
  try {
    info = await stat(inputPath);
  } catch {
    throw new Error(`Path not found: ${inputPath}`);
  }

  if (info.isFile()) {
    return [
      {
        key: "index.html",
        absPath: inputPath,
        contentType: contentTypeFor(basename(inputPath)),
        size: info.size,
      },
    ];
  }

  const out = await walkDir(inputPath, inputPath);
  if (out.length === 0) throw new Error(`Folder is empty: ${inputPath}`);
  return out;
}
