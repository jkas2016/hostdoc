import { describe, it, expect } from "vitest";
import { generateCode, isValidSlug, isValidCode, SLUG_RE } from "../src/lib/code.js";

describe("generateCode", () => {
  it("returns 7 base62 chars by default", () => {
    const code = generateCode();
    expect(code).toMatch(/^[0-9A-Za-z]{7}$/);
  });
  it("honors a custom length", () => {
    expect(generateCode(10)).toHaveLength(10);
  });
  it("is non-deterministic across calls", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateCode()));
    expect(codes.size).toBeGreaterThan(40);
  });
});

describe("isValidSlug", () => {
  it.each(["a", "aws-design", "doc1", "a-b-c"])("accepts %s", (s) => {
    expect(isValidSlug(s)).toBe(true);
  });
  it.each(["", "-lead", "_meta", "UpperCase", "has space", "a/b", "x".repeat(64)])(
    "rejects %s",
    (s) => {
      expect(isValidSlug(s)).toBe(false);
    },
  );
  it("exposes the regex", () => {
    expect(SLUG_RE.test("ok-slug")).toBe(true);
  });
});

describe("isValidCode", () => {
  it.each(["spinIYr", "Abc123Z", "7charXX", "abc1234", "doc1", "a"])(
    "accepts base62 code %j",
    (s) => {
      expect(isValidCode(s)).toBe(true);
    },
  );
  it.each(["", "_meta", "a b", "a/b", "x#y", "../escape", "x".repeat(64)])(
    "rejects %j",
    (s) => {
      expect(isValidCode(s)).toBe(false);
    },
  );
});
