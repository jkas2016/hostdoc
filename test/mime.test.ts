import { describe, it, expect } from "vitest";
import { contentTypeFor } from "../src/lib/mime.js";

describe("contentTypeFor", () => {
  it("maps html with charset", () => {
    expect(contentTypeFor("index.html")).toBe("text/html; charset=utf-8");
  });
  it("maps css and js and png", () => {
    expect(contentTypeFor("a.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeFor("a.js")).toMatch(/javascript/);
    expect(contentTypeFor("a.png")).toBe("image/png");
  });
  it("falls back to octet-stream for unknown", () => {
    expect(contentTypeFor("file.unknownext")).toBe("application/octet-stream");
  });
});
