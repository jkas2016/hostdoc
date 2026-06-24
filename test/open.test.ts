import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveOpenUrl } from "../src/commands/open.js";
import { describeConfig } from "../src/commands/config.js";
import { openerCommand } from "../src/lib/browser.js";

beforeEach(() => {
  process.env.HOSTDOC_BUCKET = "b";
  process.env.HOSTDOC_REGION = "us-east-1";
});
afterEach(() => {
  delete process.env.HOSTDOC_BUCKET;
  delete process.env.HOSTDOC_REGION;
});

describe("openerCommand", () => {
  it("selects the platform opener", () => {
    expect(openerCommand("darwin").cmd).toBe("open");
    expect(openerCommand("linux").cmd).toBe("xdg-open");
    expect(openerCommand("win32").cmd).toBe("cmd");
  });
});

describe("resolveOpenUrl", () => {
  it("builds the URL for a code", () => {
    expect(resolveOpenUrl({ id: "abc" })).toBe(
      "http://b.s3-website-us-east-1.amazonaws.com/abc/",
    );
  });

  it.each(["a b", "../escape", "x?y", "x#y", "Doc1", "_meta"])(
    "rejects invalid id %j",
    (id) => {
      expect(() => resolveOpenUrl({ id })).toThrow(/invalid id/i);
    },
  );
});

describe("describeConfig", () => {
  it("summarizes the active config", () => {
    expect(describeConfig({})).toMatch(/s3-website/);
    expect(describeConfig({})).toMatch(/bucket: b/);
  });
});
