import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
import { execFileSync } from "node:child_process";
import { runDeprovision } from "../src/commands/deprovision.js";

const mockExec = vi.mocked(execFileSync);
const FLAGS = { hostedZone: "example.com", subdomain: "shared", region: "ap-northeast-2" };

let dir: string;
beforeEach(() => {
  mockExec.mockReset();
  mockExec.mockReturnValue("");
  dir = mkdtempSync(join(tmpdir(), "hostdoc-deprov-"));
  writeFileSync(join(dir, "main.tf"), "# seeded\n"); // extractTemplates no-ops
});

describe("runDeprovision", () => {
  it("writes tfvars from flags, runs init then destroy (interactive by default)", () => {
    runDeprovision({ dir, flags: FLAGS });

    expect(readFileSync(join(dir, "terraform.tfvars"), "utf8")).toContain(
      'aws_region       = "ap-northeast-2"',
    );
    const argLists = mockExec.mock.calls.map((c) => c[1] as string[]);
    const initIdx = argLists.findIndex((a) => a.includes("init"));
    const destroyIdx = argLists.findIndex((a) => a.includes("destroy"));
    expect(initIdx).toBeGreaterThanOrEqual(0);
    expect(destroyIdx).toBeGreaterThan(initIdx);
    expect(argLists[destroyIdx]).toContain(`-chdir=${dir}`);
    expect(argLists[destroyIdx]).not.toContain("-auto-approve");
  });

  it("uses an existing tfvars when no flags are passed", () => {
    writeFileSync(join(dir, "terraform.tfvars"), 'subdomain = "cached"\n');
    expect(() => runDeprovision({ dir })).not.toThrow();
    const destroyCall = mockExec.mock.calls.map((c) => c[1] as string[]).find((a) => a.includes("destroy"));
    expect(destroyCall).toBeDefined();
  });

  it("throws before terraform when no flags and no tfvars exist", () => {
    expect(() => runDeprovision({ dir })).toThrow(/--hosted-zone/);
    const ranTerraform = mockExec.mock.calls.some((c) =>
      (c[1] as string[]).some((a) => a.includes("init") || a.includes("destroy")),
    );
    expect(ranTerraform).toBe(false);
  });

  it("appends -auto-approve when approve is set", () => {
    runDeprovision({ dir, approve: true, flags: FLAGS });
    const destroyCall = mockExec.mock.calls.map((c) => c[1] as string[]).find((a) => a.includes("destroy"));
    expect(destroyCall).toContain("-auto-approve");
  });

  it("fails fast if terraform init fails (destroy never reached)", () => {
    mockExec.mockImplementation((_cmd, args) => {
      if ((args as string[]).includes("init")) throw new Error("terraform init failed");
      return "";
    });
    expect(() => runDeprovision({ dir, flags: FLAGS })).toThrow(/init failed/);
    const reachedDestroy = mockExec.mock.calls.some((c) => (c[1] as string[]).includes("destroy"));
    expect(reachedDestroy).toBe(false);
  });

  it("reports a friendly error when terraform is not installed", () => {
    mockExec.mockImplementation(() => {
      throw Object.assign(new Error("spawnSync terraform ENOENT"), { code: "ENOENT" });
    });
    expect(() => runDeprovision({ dir, flags: FLAGS })).toThrow(/terraform is not installed/i);
  });
});
