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
  it("emits JSON for the required vars plus price_class", () => {
    writeTfvars(dir, {
      hostedZone: "example.com",
      subdomain: "shared",
      region: "us-east-1",
      priceClass: "PriceClass_100",
    });
    const obj = JSON.parse(readFileSync(tfvarsPath(dir), "utf8"));
    expect(obj).toEqual({
      hosted_zone_name: "example.com",
      subdomain: "shared",
      aws_region: "us-east-1",
      price_class: "PriceClass_100",
    });
  });

  it("omits price_class when not provided", () => {
    writeTfvars(dir, { hostedZone: "a.com", subdomain: "s", region: "r" });
    const obj = JSON.parse(readFileSync(tfvarsPath(dir), "utf8"));
    expect(obj).not.toHaveProperty("price_class");
  });

  it("writes interpolation sequences and quotes literally (no HCL injection)", () => {
    const nasty = '${path.module}%{ for x in y }"\\';
    writeTfvars(dir, { hostedZone: nasty, subdomain: "s", region: "r" });
    const raw = readFileSync(tfvarsPath(dir), "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw).hosted_zone_name).toBe(nasty);
  });

  it("writes the terraform.tfvars.json filename", () => {
    writeTfvars(dir, { hostedZone: "a.com", subdomain: "s", region: "r" });
    expect(existsSync(join(dir, "terraform.tfvars.json"))).toBe(true);
  });

  it("removes a legacy plain terraform.tfvars when writing fresh", () => {
    writeFileSync(join(dir, "terraform.tfvars"), 'subdomain = "old"\n');
    writeTfvars(dir, { hostedZone: "a.com", subdomain: "s", region: "r" });
    expect(existsSync(join(dir, "terraform.tfvars"))).toBe(false);
    expect(existsSync(join(dir, "terraform.tfvars.json"))).toBe(true);
  });
});

describe("ensureTfvars", () => {
  it("writes tfvars when all three required flags are present", () => {
    ensureTfvars(dir, { hostedZone: "example.com", subdomain: "shared", region: "us-east-1" });
    const obj = JSON.parse(readFileSync(tfvarsPath(dir), "utf8"));
    expect(obj.subdomain).toBe("shared");
  });

  it("overwrites an existing tfvars (flags win)", () => {
    writeFileSync(tfvarsPath(dir), '{ "subdomain": "old" }\n');
    ensureTfvars(dir, { hostedZone: "new.com", subdomain: "fresh", region: "r" });
    const obj = JSON.parse(readFileSync(tfvarsPath(dir), "utf8"));
    expect(obj.subdomain).toBe("fresh");
  });

  it("throws naming the missing flag when only some required flags are given", () => {
    expect(() => ensureTfvars(dir, { hostedZone: "example.com" })).toThrow(/--subdomain.*--region|--region.*--subdomain/);
  });

  it("uses an existing tfvars.json when no flags are given", () => {
    writeFileSync(tfvarsPath(dir), '{ "subdomain": "cached" }\n');
    expect(() => ensureTfvars(dir, {})).not.toThrow();
    expect(readFileSync(tfvarsPath(dir), "utf8")).toBe('{ "subdomain": "cached" }\n');
  });

  it("uses an existing legacy terraform.tfvars when no flags are given (back-compat)", () => {
    writeFileSync(join(dir, "terraform.tfvars"), 'subdomain = "cached"\n');
    expect(() => ensureTfvars(dir, {})).not.toThrow();
    expect(readFileSync(join(dir, "terraform.tfvars"), "utf8")).toBe('subdomain = "cached"\n');
  });

  it("throws when no flags and no tfvars exist", () => {
    expect(() => ensureTfvars(dir, {})).toThrow(/--hosted-zone/);
    expect(existsSync(tfvarsPath(dir))).toBe(false);
    expect(existsSync(join(dir, "terraform.tfvars"))).toBe(false);
  });
});
