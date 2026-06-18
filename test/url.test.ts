import { describe, it, expect } from "vitest";
import { websiteEndpoint, buildPublicUrl } from "../src/lib/url.js";
import type { Config } from "../src/lib/config.js";

describe("websiteEndpoint", () => {
  it("uses dash style for classic regions", () => {
    expect(websiteEndpoint("b", "us-east-1")).toBe(
      "http://b.s3-website-us-east-1.amazonaws.com",
    );
  });
  it("uses dot style for newer regions", () => {
    expect(websiteEndpoint("b", "ap-northeast-2")).toBe(
      "http://b.s3-website.ap-northeast-2.amazonaws.com",
    );
  });
});

describe("buildPublicUrl", () => {
  it("s3-website mode appends code with trailing slash", () => {
    const cfg: Config = {
      mode: "s3-website",
      bucket: "b",
      region: "us-east-1",
      websiteEndpoint: "http://b.s3-website-us-east-1.amazonaws.com",
    };
    expect(buildPublicUrl(cfg, "x7Kq2a")).toBe(
      "http://b.s3-website-us-east-1.amazonaws.com/x7Kq2a/",
    );
  });
  it("cloudfront mode uses https domain", () => {
    const cfg: Config = {
      mode: "cloudfront",
      bucket: "b",
      region: "us-east-1",
      distributionId: "E123",
      domain: "shared.example.com",
    };
    expect(buildPublicUrl(cfg, "abc")).toBe("https://shared.example.com/abc/");
  });
});
