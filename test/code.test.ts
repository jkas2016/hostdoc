import { describe, it, expect } from "vitest";
import { generateCode, isValidSlug, isValidPath, isValidCode, SLUG_RE } from "../src/lib/code.js";

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
  it("produces a near-uniform distribution (no modulo bias)", () => {
    // A `byte % 62` mapping over-represents the first 8 alphabet chars ('0'-'7')
    // by ~25% (256 = 4*62 + 8). A uniform generator keeps every char equal.
    const ALPHABET =
      "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const counts = new Map<string, number>();
    for (const ch of generateCode(100_000)) {
      counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    expect(counts.size).toBe(62); // every alphabet char appears
    const mean = (chars: string) =>
      [...chars].reduce((s, c) => s + (counts.get(c) ?? 0), 0) / chars.length;
    const ratio = mean(ALPHABET.slice(0, 8)) / mean(ALPHABET.slice(8));
    // Biased impl ~1.25, uniform ~1.0 (±~0.012 over 100k); 1.1 separates them.
    expect(ratio).toBeLessThan(1.1);
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

describe("isValidPath", () => {
  it.each(["a", "report", "team/q1/report", "a/b", "aws-design", "a".repeat(63)])(
    "accepts %j",
    (p) => {
      expect(isValidPath(p)).toBe(true);
    },
  );
  it.each([
    "",
    "team//q1",
    "/team",
    "team/",
    "../etc",
    "team/..",
    ".",
    "team/_x",
    "_meta/x",
    "UpperCase",
    "has space",
    "team/" + "x".repeat(64),
  ])("rejects %j", (p) => {
    expect(isValidPath(p)).toBe(false);
  });
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
