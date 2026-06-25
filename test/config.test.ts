import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  configPath,
  infraDir,
  saveConfig,
  loadConfig,
  resolveConfig,
  type Config,
} from "../src/lib/config.js";

let dir: string;
const ENV_KEYS = [
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
  "HOSTDOC_BUCKET",
  "HOSTDOC_REGION",
  "HOSTDOC_DOMAIN",
  "HOSTDOC_DISTRIBUTION",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  dir = mkdtempSync(join(tmpdir(), "sf-"));
  process.env.XDG_CONFIG_HOME = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("configPath", () => {
  it("is under XDG_CONFIG_HOME/hostdoc", () => {
    expect(configPath()).toBe(join(dir, "hostdoc", "config.json"));
  });
});

describe("infraDir", () => {
  it("is under XDG_STATE_HOME/hostdoc/infra when set", () => {
    process.env.XDG_STATE_HOME = dir;
    expect(infraDir()).toBe(join(dir, "hostdoc", "infra"));
  });
  it("falls back to ~/.local/state/hostdoc/infra (cwd-independent) when unset", () => {
    // XDG_STATE_HOME is deleted in beforeEach.
    const got = infraDir();
    expect(got).toBe(join(homedir(), ".local", "state", "hostdoc", "infra"));
    expect(got).not.toContain(process.cwd());
  });
});

describe("save/load", () => {
  it("round-trips a config", () => {
    const cfg: Config = {
      mode: "s3-website",
      bucket: "b",
      region: "us-east-1",
      websiteEndpoint: "http://b.s3-website-us-east-1.amazonaws.com",
    };
    saveConfig(cfg);
    expect(existsSync(configPath())).toBe(true);
    expect(loadConfig()).toEqual(cfg);
  });
  it("loadConfig returns null when absent", () => {
    expect(loadConfig()).toBeNull();
  });
  it("loadConfig throws a path-tagged error on corrupt JSON", () => {
    const p = configPath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, "{ not valid json");
    expect(() => loadConfig()).toThrow(new RegExp(p.replace(/[.\\]/g, "\\$&")));
  });
  it("loadConfig rejects a non-object JSON value (no silent undefined fields)", () => {
    const p = configPath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, "42");
    expect(() => loadConfig()).toThrow(/object/);
  });
});

describe("resolveConfig", () => {
  it("derives s3-website mode + endpoint from env bucket+region", () => {
    process.env.HOSTDOC_BUCKET = "envb";
    process.env.HOSTDOC_REGION = "us-east-1";
    const cfg = resolveConfig({});
    expect(cfg.mode).toBe("s3-website");
    expect(cfg.websiteEndpoint).toBe(
      "http://envb.s3-website-us-east-1.amazonaws.com",
    );
  });
  it("derives cloudfront mode from domain+distribution", () => {
    const cfg = resolveConfig({
      bucket: "b",
      region: "us-east-1",
      domain: "shared.example.com",
      distribution: "E1",
    });
    expect(cfg.mode).toBe("cloudfront");
    expect(cfg.domain).toBe("shared.example.com");
  });
  it("flags override the file", () => {
    saveConfig({
      mode: "s3-website",
      bucket: "fileb",
      region: "us-east-1",
      websiteEndpoint: "http://fileb.s3-website-us-east-1.amazonaws.com",
    });
    const cfg = resolveConfig({ bucket: "flagb" });
    expect(cfg.bucket).toBe("flagb");
  });
  it("throws a helpful error when nothing is configured", () => {
    expect(() => resolveConfig({})).toThrow(/hostdoc setup/);
  });
  it("rejects partial cloudfront config: domain without distribution (no silent s3-website downgrade)", () => {
    expect(() =>
      resolveConfig({ bucket: "b", region: "us-east-1", domain: "x.example.com" }),
    ).toThrow(/'domain' set without 'distributionId'/);
  });
  it("rejects partial cloudfront config: distribution without domain", () => {
    expect(() =>
      resolveConfig({ bucket: "b", region: "us-east-1", distribution: "E1" }),
    ).toThrow(/'distributionId' set without 'domain'/);
  });
});
