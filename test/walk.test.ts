import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectUploads } from "../src/lib/walk.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sf-walk-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("collectUploads", () => {
  it("maps a single file to index.html with its content-type", async () => {
    const f = join(dir, "report.html");
    writeFileSync(f, "<html></html>");
    const ups = await collectUploads(f);
    expect(ups).toHaveLength(1);
    expect(ups[0].key).toBe("index.html");
    expect(ups[0].contentType).toBe("text/html; charset=utf-8");
    expect(ups[0].size).toBeGreaterThan(0);
  });

  it("walks a folder recursively with posix keys", async () => {
    writeFileSync(join(dir, "index.html"), "<html></html>");
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "app.css"), "body{}");
    const ups = await collectUploads(dir);
    const keys = ups.map((u) => u.key).sort();
    expect(keys).toEqual(["assets/app.css", "index.html"]);
  });

  it("throws on a missing path", async () => {
    await expect(collectUploads(join(dir, "nope"))).rejects.toThrow(/not found/);
  });

  it("throws on an empty folder", async () => {
    const empty = join(dir, "empty");
    mkdirSync(empty);
    await expect(collectUploads(empty)).rejects.toThrow(/empty/);
  });

  it("walks a deeply nested tree, preserving all keys", async () => {
    writeFileSync(join(dir, "index.html"), "<html></html>");
    mkdirSync(join(dir, "a"));
    mkdirSync(join(dir, "a", "b"));
    writeFileSync(join(dir, "a", "top.css"), "body{}");
    writeFileSync(join(dir, "a", "b", "deep.js"), "//x");
    const ups = await collectUploads(dir);
    const keys = ups.map((u) => u.key).sort();
    expect(keys).toEqual(["a/b/deep.js", "a/top.css", "index.html"]);
  });
});
