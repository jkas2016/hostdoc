import { describe, it, expect, beforeEach, vi } from "vitest";

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

beforeEach(() => {
  mockExec.mockReset();
  // init/apply return ""; the `output -json` call returns the fixture.
  mockExec.mockImplementation((_cmd, args) =>
    (args as string[]).includes("output") ? OUTPUTS : "",
  );
});

describe("runProvision", () => {
  it("runs terraform init then apply, then writes a cloudfront config", () => {
    const cfg = runProvision({ dir: "./infra" });

    const argLists = mockExec.mock.calls.map((c) => c[1] as string[]);
    const initIdx = argLists.findIndex((a) => a.includes("init"));
    const applyIdx = argLists.findIndex((a) => a.includes("apply"));
    expect(initIdx).toBeGreaterThanOrEqual(0);
    expect(applyIdx).toBeGreaterThan(initIdx); // init before apply
    expect(argLists[initIdx]).toContain("-chdir=./infra");
    expect(argLists[applyIdx]).not.toContain("-auto-approve"); // interactive by default

    expect(cfg.mode).toBe("cloudfront");
    expect(cfg.domain).toBe("shared.example.com");
    expect(cfg.region).toBe("ap-northeast-2");
    expect(loadConfig()).toEqual(cfg);
  });

  it("appends -auto-approve when approve is set", () => {
    runProvision({ dir: "./infra", approve: true });
    const applyCall = mockExec.mock.calls
      .map((c) => c[1] as string[])
      .find((a) => a.includes("apply"));
    expect(applyCall).toContain("-auto-approve");
  });

  it("fails fast and propagates if terraform init fails (apply never reached)", () => {
    mockExec.mockImplementation((_cmd, args) => {
      if ((args as string[]).includes("init")) throw new Error("terraform init failed");
      return "";
    });
    expect(() => runProvision({ dir: "./infra" })).toThrow(/init failed/);
    const reachedApply = mockExec.mock.calls.some((c) =>
      (c[1] as string[]).includes("apply"),
    );
    expect(reachedApply).toBe(false);
  });
});
