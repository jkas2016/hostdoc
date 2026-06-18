import { readdir, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { contentTypeFor } from "./mime.js";

export interface Upload {
  key: string; // relative key under <code>/, posix separators
  absPath: string;
  contentType: string;
  size: number;
}

async function walkDir(root: string, current: string, out: Upload[]) {
  const entries = await readdir(current, { withFileTypes: true });
  for (const e of entries) {
    const abs = join(current, e.name);
    if (e.isDirectory()) {
      await walkDir(root, abs, out);
    } else if (e.isFile()) {
      const rel = relative(root, abs).split(sep).join("/");
      const s = await stat(abs);
      out.push({
        key: rel,
        absPath: abs,
        contentType: contentTypeFor(e.name),
        size: s.size,
      });
    }
  }
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

  const out: Upload[] = [];
  await walkDir(inputPath, inputPath, out);
  if (out.length === 0) throw new Error(`Folder is empty: ${inputPath}`);
  return out;
}
