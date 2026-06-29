import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
import { execFileSync } from "node:child_process";
import { prepareInfra, approvable } from "../src/lib/terraform.js";

const mockExec = vi.mocked(execFileSync);
const FLAGS = { hostedZone: "example.com", subdomain: "shared", region: "ap-northeast-2" };

describe("approvable", () => {
  it("appends -auto-approve only when approve is set", () => {
    expect(approvable("apply", true)).toEqual(["apply", "-auto-approve"]);
    expect(approvable("destroy", false)).toEqual(["destroy"]);
    expect(approvable("apply")).toEqual(["apply"]);
  });
});

describe("prepareInfra", () => {
  let dir: string;
  beforeEach(() => {
    mockExec.mockReset();
    mockExec.mockReturnValue("");
    dir = mkdtempSync(join(tmpdir(), "hostdoc-infra-"));
    writeFileSync(join(dir, "main.tf"), "# seeded\n"); // extractTemplates no-ops
  });

  it("writes tfvars from flags then runs a non-interactive init", () => {
    prepareInfra(dir, FLAGS);
    expect(
      JSON.parse(readFileSync(join(dir, "terraform.tfvars.json"), "utf8")).hosted_zone_name,
    ).toBe("example.com");
    const initCall = mockExec.mock.calls
      .map((c) => c[1] as string[])
      .find((a) => a.includes("init"));
    expect(initCall).toEqual([`-chdir=${dir}`, "init", "-input=false"]);
  });

  it("throws before terraform when no flags and no tfvars exist", () => {
    expect(() => prepareInfra(dir)).toThrow(/--hosted-zone/);
    expect(mockExec).not.toHaveBeenCalled();
  });
});
