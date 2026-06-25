import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractTemplates,
  hasTfFiles,
  firstExistingDir,
  TEMPLATE_FILES,
} from "../src/lib/templates.js";

let src: string;
let dest: string;

beforeEach(() => {
  // A fake "bundled templates" dir so the test needs no build.
  src = mkdtempSync(join(tmpdir(), "hostdoc-tpl-src-"));
  for (const f of TEMPLATE_FILES) writeFileSync(join(src, f), `# ${f}\n`);
  dest = mkdtempSync(join(tmpdir(), "hostdoc-tpl-dest-"));
});

describe("extractTemplates", () => {
  it("copies every allowlisted file into an empty dir", () => {
    const target = join(dest, "infra");
    const res = extractTemplates(target, src);
    expect(res.extracted).toBe(true);
    for (const f of TEMPLATE_FILES) {
      expect(existsSync(join(target, f))).toBe(true);
    }
  });

  it("is a no-op when the dir already has a .tf (never clobbers)", () => {
    mkdirSync(join(dest, "infra"), { recursive: true });
    const target = join(dest, "infra");
    writeFileSync(join(target, "main.tf"), "# user edits\n");
    const res = extractTemplates(target, src);
    expect(res.extracted).toBe(false);
    expect(readFileSync(join(target, "main.tf"), "utf8")).toBe("# user edits\n");
    expect(existsSync(join(target, "variables.tf"))).toBe(false);
  });
});

describe("firstExistingDir", () => {
  it("returns the first existing dir", () => {
    expect(
      firstExistingDir(["/no/a", "/yes/b", "/yes/c"], (d) => d.startsWith("/yes")),
    ).toBe("/yes/b");
  });
  it("falls back to the last entry when none exist", () => {
    expect(firstExistingDir(["/no/a", "/no/b"], () => false)).toBe("/no/b");
  });
});

describe("bundledTemplatesDir fallback (from source)", () => {
  it("extractTemplates with the default src copies every template file", () => {
    const target = join(dest, "infra-default");
    const res = extractTemplates(target); // default srcDir = bundledTemplatesDir()
    expect(res.extracted).toBe(true);
    for (const f of TEMPLATE_FILES) {
      expect(existsSync(join(target, f))).toBe(true);
    }
  });
});

describe("hasTfFiles", () => {
  it("is false for a missing or .tf-free dir, true once a .tf exists", () => {
    const d = join(dest, "x");
    expect(hasTfFiles(d)).toBe(false);
    mkdirSync(d, { recursive: true });
    expect(hasTfFiles(d)).toBe(false);
    writeFileSync(join(d, "main.tf"), "");
    expect(hasTfFiles(d)).toBe(true);
  });
});
