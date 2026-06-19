import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
import { execFileSync } from "node:child_process";
import { runDeprovision } from "../src/commands/deprovision.js";

const mockExec = vi.mocked(execFileSync);

beforeEach(() => {
  mockExec.mockReset();
  mockExec.mockReturnValue("");
});

describe("runDeprovision", () => {
  it("runs terraform init then destroy (interactive by default)", () => {
    runDeprovision({ dir: "./infra" });

    const argLists = mockExec.mock.calls.map((c) => c[1] as string[]);
    const initIdx = argLists.findIndex((a) => a.includes("init"));
    const destroyIdx = argLists.findIndex((a) => a.includes("destroy"));
    expect(initIdx).toBeGreaterThanOrEqual(0);
    expect(destroyIdx).toBeGreaterThan(initIdx); // init before destroy
    expect(argLists[destroyIdx]).toContain("-chdir=./infra");
    expect(argLists[destroyIdx]).not.toContain("-auto-approve"); // interactive by default
  });

  it("appends -auto-approve when approve is set", () => {
    runDeprovision({ dir: "./infra", approve: true });
    const destroyCall = mockExec.mock.calls
      .map((c) => c[1] as string[])
      .find((a) => a.includes("destroy"));
    expect(destroyCall).toContain("-auto-approve");
  });

  it("fails fast and propagates if terraform init fails (destroy never reached)", () => {
    mockExec.mockImplementation((_cmd, args) => {
      if ((args as string[]).includes("init")) throw new Error("terraform init failed");
      return "";
    });
    expect(() => runDeprovision({ dir: "./infra" })).toThrow(/init failed/);
    const reachedDestroy = mockExec.mock.calls.some((c) =>
      (c[1] as string[]).includes("destroy"),
    );
    expect(reachedDestroy).toBe(false);
  });
});
