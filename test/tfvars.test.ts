import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeTfvars, ensureTfvars, tfvarsPath } from "../src/lib/tfvars.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hostdoc-tfvars-"));
});

describe("writeTfvars", () => {
  it("emits HCL for the required vars plus price_class", () => {
    writeTfvars(dir, {
      hostedZone: "example.com",
      subdomain: "shared",
      region: "us-east-1",
      priceClass: "PriceClass_100",
    });
    const txt = readFileSync(tfvarsPath(dir), "utf8");
    expect(txt).toContain('hosted_zone_name = "example.com"');
    expect(txt).toContain('subdomain        = "shared"');
    expect(txt).toContain('aws_region       = "us-east-1"');
    expect(txt).toContain('price_class      = "PriceClass_100"');
  });

  it("omits price_class when not provided", () => {
    writeTfvars(dir, { hostedZone: "a.com", subdomain: "s", region: "r" });
    expect(readFileSync(tfvarsPath(dir), "utf8")).not.toContain("price_class");
  });

  it("escapes quotes in values", () => {
    writeTfvars(dir, { hostedZone: 'a"b.com', subdomain: "s", region: "r" });
    expect(readFileSync(tfvarsPath(dir), "utf8")).toContain('hosted_zone_name = "a\\"b.com"');
  });
});

describe("ensureTfvars", () => {
  it("writes tfvars when all three required flags are present", () => {
    ensureTfvars(dir, { hostedZone: "example.com", subdomain: "shared", region: "us-east-1" });
    expect(readFileSync(tfvarsPath(dir), "utf8")).toContain('subdomain        = "shared"');
  });

  it("overwrites an existing tfvars (flags win)", () => {
    writeFileSync(tfvarsPath(dir), 'subdomain = "old"\n');
    ensureTfvars(dir, { hostedZone: "new.com", subdomain: "fresh", region: "r" });
    expect(readFileSync(tfvarsPath(dir), "utf8")).toContain('subdomain        = "fresh"');
  });

  it("throws naming the missing flag when only some required flags are given", () => {
    expect(() => ensureTfvars(dir, { hostedZone: "example.com" })).toThrow(/--subdomain.*--region|--region.*--subdomain/);
  });

  it("uses an existing tfvars when no flags are given", () => {
    writeFileSync(tfvarsPath(dir), 'subdomain = "cached"\n');
    expect(() => ensureTfvars(dir, {})).not.toThrow();
    expect(readFileSync(tfvarsPath(dir), "utf8")).toBe('subdomain = "cached"\n');
  });

  it("throws when no flags and no tfvars exist", () => {
    expect(() => ensureTfvars(dir, {})).toThrow(/--hosted-zone/);
    expect(existsSync(tfvarsPath(dir))).toBe(false);
  });
});
