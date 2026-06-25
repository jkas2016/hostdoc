import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/lib/browser.js", () => ({
  openInBrowser: vi.fn(),
  openerCommand: () => ({ cmd: "noop", args: (u: string) => [u] }),
}));

import { openPublishedUrl } from "../src/commands/open.js";
import { openInBrowser } from "../src/lib/browser.js";

beforeEach(() => {
  process.env.HOSTDOC_BUCKET = "envbkt";
  process.env.HOSTDOC_REGION = "us-east-1";
  vi.mocked(openInBrowser).mockClear();
});
afterEach(() => {
  delete process.env.HOSTDOC_BUCKET;
  delete process.env.HOSTDOC_REGION;
});

describe("openPublishedUrl", () => {
  it("forwards overrides so the opened URL matches the override config", () => {
    const url = openPublishedUrl(
      "http://envbkt.s3-website-us-east-1.amazonaws.com/abc/",
      { bucket: "flagbkt", region: "us-east-1" },
    );
    expect(url).toBe("http://flagbkt.s3-website-us-east-1.amazonaws.com/abc/");
    expect(openInBrowser).toHaveBeenCalledWith(
      "http://flagbkt.s3-website-us-east-1.amazonaws.com/abc/",
    );
  });

  it("falls back to ambient config when no overrides are given", () => {
    const url = openPublishedUrl(
      "http://envbkt.s3-website-us-east-1.amazonaws.com/abc/",
    );
    expect(url).toBe("http://envbkt.s3-website-us-east-1.amazonaws.com/abc/");
  });
});
