import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
import { execFileSync } from "node:child_process";
import { runInit } from "../src/commands/init.js";
import { loadConfig } from "../src/lib/config.js";

const mockExec = vi.mocked(execFileSync);

const FIXTURE = JSON.stringify({
  bucket_name: { value: "shared.example.com", type: "string" },
  region: { value: "us-east-1", type: "string" },
  distribution_id: { value: "E123ABC", type: "string" },
  site_domain: { value: "shared.example.com", type: "string" },
});

beforeEach(() => mockExec.mockReset());

describe("runInit", () => {
  it("writes a cloudfront config from terraform outputs", () => {
    mockExec.mockReturnValue(FIXTURE);
    const cfg = runInit({ dir: "./infra" });

    expect(cfg).toEqual({
      mode: "cloudfront",
      bucket: "shared.example.com",
      region: "us-east-1",
      distributionId: "E123ABC",
      domain: "shared.example.com",
    });
    expect(loadConfig()).toEqual(cfg);
    expect(mockExec).toHaveBeenCalledWith(
      "terraform",
      ["-chdir=./infra", "output", "-json"],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });

  it("throws a helpful error when terraform is unavailable", () => {
    mockExec.mockImplementationOnce(() => {
      throw Object.assign(new Error("spawn terraform ENOENT"), { code: "ENOENT" });
    });
    expect(() => runInit({ dir: "./infra" })).toThrow(/terraform/i);
  });

  it("throws when a required output is missing", () => {
    mockExec.mockReturnValue(JSON.stringify({ region: { value: "us-east-1" } }));
    expect(() => runInit({ dir: "./infra" })).toThrow(/bucket_name/);
  });
});
