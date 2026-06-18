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
});

describe("describeConfig", () => {
  it("summarizes the active config", () => {
    expect(describeConfig({})).toMatch(/s3-website/);
    expect(describeConfig({})).toMatch(/bucket: b/);
  });
});
