import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
import { execFileSync } from "node:child_process";
import { runProvision } from "../src/commands/provision.js";
import { loadConfig } from "../src/lib/config.js";

const mockExec = vi.mocked(execFileSync);

const OUTPUTS = JSON.stringify({
  bucket_name: { value: "shared.example.com" },
  region: { value: "ap-northeast-2" },
  distribution_id: { value: "E123ABC" },
  site_domain: { value: "shared.example.com" },
});

const FLAGS = { hostedZone: "example.com", subdomain: "shared", region: "ap-northeast-2" };

let dir: string;
beforeEach(() => {
  mockExec.mockReset();
  mockExec.mockImplementation((_cmd, args) =>
    (args as string[]).includes("output") ? OUTPUTS : "",
  );
  // Seed a .tf so extractTemplates() no-ops (no build needed in tests).
  dir = mkdtempSync(join(tmpdir(), "hostdoc-prov-"));
  writeFileSync(join(dir, "main.tf"), "# seeded\n");
});

describe("runProvision", () => {
  it("writes tfvars from flags, runs init then apply, writes a cloudfront config", () => {
    const cfg = runProvision({ dir, flags: FLAGS });

    expect(readFileSync(join(dir, "terraform.tfvars"), "utf8")).toContain(
      'hosted_zone_name = "example.com"',
    );

    const argLists = mockExec.mock.calls.map((c) => c[1] as string[]);
    const initIdx = argLists.findIndex((a) => a.includes("init"));
    const applyIdx = argLists.findIndex((a) => a.includes("apply"));
    expect(initIdx).toBeGreaterThanOrEqual(0);
    expect(applyIdx).toBeGreaterThan(initIdx);
    expect(argLists[initIdx]).toContain(`-chdir=${dir}`);
    expect(argLists[applyIdx]).not.toContain("-auto-approve");

    expect(cfg.mode).toBe("cloudfront");
    expect(cfg.domain).toBe("shared.example.com");
    expect(loadConfig()).toEqual(cfg);
  });

  it("lets flags overwrite an existing tfvars", () => {
    writeFileSync(join(dir, "terraform.tfvars"), 'subdomain = "old"\n');
    runProvision({ dir, flags: { ...FLAGS, subdomain: "fresh" } });
    expect(readFileSync(join(dir, "terraform.tfvars"), "utf8")).toContain(
      'subdomain        = "fresh"',
    );
  });

  it("uses an existing tfvars when no flags are passed", () => {
    writeFileSync(join(dir, "terraform.tfvars"), 'subdomain = "cached"\n');
    expect(() => runProvision({ dir })).not.toThrow();
    expect(readFileSync(join(dir, "terraform.tfvars"), "utf8")).toBe('subdomain = "cached"\n');
  });

  it("throws before terraform when no flags and no tfvars exist", () => {
    expect(() => runProvision({ dir })).toThrow(/--hosted-zone/);
    const ranTerraform = mockExec.mock.calls.some((c) =>
      (c[1] as string[]).some((a) => a.includes("init") || a.includes("apply")),
    );
    expect(ranTerraform).toBe(false);
  });

  it("appends -auto-approve when approve is set", () => {
    runProvision({ dir, approve: true, flags: FLAGS });
    const applyCall = mockExec.mock.calls
      .map((c) => c[1] as string[])
      .find((a) => a.includes("apply"));
    expect(applyCall).toContain("-auto-approve");
  });

  it("fails fast if terraform init fails (apply never reached)", () => {
    mockExec.mockImplementation((_cmd, args) => {
      if ((args as string[]).includes("init")) throw new Error("terraform init failed");
      return "";
    });
    expect(() => runProvision({ dir, flags: FLAGS })).toThrow(/init failed/);
    const reachedApply = mockExec.mock.calls.some((c) => (c[1] as string[]).includes("apply"));
    expect(reachedApply).toBe(false);
  });

  it("reports a friendly error when terraform is not installed", () => {
    mockExec.mockImplementation(() => {
      throw Object.assign(new Error("spawnSync terraform ENOENT"), { code: "ENOENT" });
    });
    expect(() => runProvision({ dir, flags: FLAGS })).toThrow(/terraform is not installed/i);
  });
});
