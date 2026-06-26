import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveOpenUrl } from "../src/commands/open.js";
import { describeConfig } from "../src/commands/config.js";
import { openerCommand, openInBrowser } from "../src/lib/browser.js";

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

describe("openInBrowser", () => {
  it("does not throw and prints a manual hint when the opener is missing", async () => {
    const writes: string[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(((s: string | Uint8Array) => {
        writes.push(String(s));
        return true;
      }) as typeof process.stderr.write);

    const child = openInBrowser("http://x.example/abc/", {
      cmd: "__no_such_opener__",
      args: (u) => [u],
    });
    await new Promise<void>((r) => child.on("error", () => r()));
    await new Promise((r) => setImmediate(r)); // let the production handler run

    spy.mockRestore();
    expect(writes.join("")).toContain("http://x.example/abc/");
  });
});

describe("resolveOpenUrl", () => {
  it("builds the URL for a code", () => {
    expect(resolveOpenUrl({ id: "abc" })).toBe(
      "http://b.s3-website-us-east-1.amazonaws.com/abc/",
    );
  });

  it.each(["a b", "../escape", "x?y", "x#y", "_meta"])(
    "rejects invalid id %j",
    (id) => {
      expect(() => resolveOpenUrl({ id })).toThrow(/invalid id/i);
    },
  );

  it("accepts an uppercase-containing generated code", () => {
    expect(resolveOpenUrl({ id: "spinIYr" })).toBe(
      "http://b.s3-website-us-east-1.amazonaws.com/spinIYr/",
    );
  });
});

describe("describeConfig", () => {
  it("summarizes the active config", () => {
    expect(describeConfig({})).toMatch(/s3-website/);
    expect(describeConfig({})).toMatch(/bucket: b/);
  });
});
