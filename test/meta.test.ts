import { describe, it, expect } from "vitest";
import { metaKey, extractTitle, buildMeta } from "../src/lib/meta.js";
import type { Upload } from "../src/lib/walk.js";

describe("metaKey", () => {
  it("namespaces under _meta", () => {
    expect(metaKey("abc")).toBe("_meta/abc.json");
  });
});

describe("extractTitle", () => {
  it("reads the <title>", () => {
    expect(extractTitle("<html><head><title> Hello </title></head>")).toBe(
      "Hello",
    );
  });
  it("returns null when no title", () => {
    expect(extractTitle("<html></html>")).toBeNull();
  });
});

describe("buildMeta", () => {
  it("aggregates files and bytes", () => {
    const uploads: Upload[] = [
      { key: "index.html", absPath: "/x/index.html", contentType: "text/html", size: 10 },
      { key: "a.css", absPath: "/x/a.css", contentType: "text/css", size: 5 },
    ];
    const m = buildMeta({
      code: "abc",
      slug: "abc",
      title: "T",
      uploads,
      sourcePath: "/x",
    });
    expect(m).toMatchObject({
      code: "abc",
      slug: "abc",
      title: "T",
      files: 2,
      bytes: 15,
      sourcePath: "/x",
    });
    expect(typeof m.createdAt).toBe("string");
    expect(Number.isNaN(Date.parse(m.createdAt))).toBe(false);
  });
});
