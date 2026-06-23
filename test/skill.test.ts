import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const runMjs = join(repo, "skills", "hostdoc", "scripts", "run.mjs");
const devBin = `node --import tsx ${join(repo, "src", "index.ts")}`;

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "hostdoc-skill-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("run.mjs", () => {
  it("resolves the CLI and passes args through verbatim", () => {
    const env = {
      PATH: process.env.PATH,
      HOME: tmp,
      HOSTDOC_BIN: devBin,
      XDG_CONFIG_HOME: tmp,
      HOSTDOC_BUCKET: "demo-bucket",
      HOSTDOC_REGION: "us-east-1",
    };
    const res = spawnSync("node", [runMjs, "config"], { encoding: "utf8", env });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("mode: s3-website");
    expect(res.stdout).toContain("bucket: demo-bucket");
  });

  it("classifies a failing command into guidance and still forwards raw stderr", () => {
    const fake = join(tmp, "fake.mjs");
    writeFileSync(fake, "console.error('CredentialsProviderError: token expired'); process.exit(1);\n");
    const env = { PATH: process.env.PATH, HOSTDOC_BIN: `node ${fake}` };
    const res = spawnSync("node", [runMjs, "publish", "x"], { encoding: "utf8", env });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/credentials are missing or expired/i);
    expect(res.stderr).toContain("CredentialsProviderError"); // raw output preserved
  });
});
