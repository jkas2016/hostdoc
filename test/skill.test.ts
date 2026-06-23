import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRunner, onPath, classifyError } from "../skills/hostdoc/scripts/run.mjs";

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
    // run.mjs uses stdio:"inherit" for stdout; because spawnSync here wraps run.mjs
    // in its own subprocess, run.mjs's stdout is the pipe spawnSync opened, so the
    // grandchild CLI's inherited stdout still flows back into res.stdout.
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

const preflightMjs = join(repo, "skills", "hostdoc", "scripts", "preflight.mjs");

describe("preflight.mjs", () => {
  it("reports missing config and credentials as guidance, not a stack trace", () => {
    const env = {
      PATH: process.env.PATH,
      HOME: tmp, // empty temp home → no ~/.aws
      HOSTDOC_BIN: devBin,
      XDG_CONFIG_HOME: tmp, // empty → no saved config, no HOSTDOC_* set
    };
    const res = spawnSync("node", [preflightMjs], { encoding: "utf8", env });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/No hostdoc config/i);
    expect(res.stderr).toMatch(/No AWS credentials/i);
    expect(res.stderr).not.toMatch(/\bat .*:\d+:\d+/); // no JS stack frames
  });
});

describe("skill structure", () => {
  const skillDir = join(repo, "skills", "hostdoc");
  it("has SKILL.md with name+description frontmatter", () => {
    const fm = readFileSync(join(skillDir, "SKILL.md"), "utf8").match(/^---\n([\s\S]*?)\n---/);
    expect(fm).toBeTruthy();
    expect(fm![1]).toMatch(/^name:\s*hostdoc\s*$/m);
    expect(fm![1]).toMatch(/^description:\s*\S+/m);
  });
  it("ships the wrapper scripts and references", () => {
    for (const f of [
      "scripts/run.mjs",
      "scripts/preflight.mjs",
      "references/commands.md",
      "references/troubleshooting.md",
    ]) {
      expect(existsSync(join(skillDir, f))).toBe(true);
    }
  });
});

describe("run.mjs unit (pure)", () => {
  let unitTmp: string;
  beforeEach(() => {
    unitTmp = mkdtempSync(join(tmpdir(), "hostdoc-unit-"));
  });
  afterEach(() => {
    rmSync(unitTmp, { recursive: true, force: true });
  });

  describe("resolveRunner", () => {
    it("HOSTDOC_BIN set → splits on whitespace into argv", () => {
      const env = { HOSTDOC_BIN: "node /x/cli.js" };
      expect(resolveRunner(env)).toEqual(["node", "/x/cli.js"]);
    });

    it("no HOSTDOC_BIN, hostdoc NOT on PATH → ['npx','-y','hostdoc']", () => {
      // unitTmp is an empty directory; hostdoc is not in it
      const env = { PATH: unitTmp };
      expect(resolveRunner(env)).toEqual(["npx", "-y", "hostdoc"]);
    });

    it("no HOSTDOC_BIN, hostdoc present on PATH → ['hostdoc']", () => {
      const bin = join(unitTmp, "hostdoc");
      writeFileSync(bin, "#!/bin/sh\n");
      chmodSync(bin, 0o755);
      const env = { PATH: unitTmp };
      expect(resolveRunner(env)).toEqual(["hostdoc"]);
    });
  });

  describe("onPath", () => {
    it("returns true when the named file exists in a PATH dir", () => {
      const bin = join(unitTmp, "mytool");
      writeFileSync(bin, "#!/bin/sh\n");
      chmodSync(bin, 0o755);
      expect(onPath("mytool", { PATH: unitTmp })).toBe(true);
    });

    it("returns false when the named file is absent from PATH", () => {
      expect(onPath("mytool", { PATH: unitTmp })).toBe(false);
    });
  });

  describe("classifyError", () => {
    it("returns credentials guidance for CredentialsProviderError", () => {
      const result = classifyError("CredentialsProviderError: token expired");
      expect(result).toMatch(/credentials are missing or expired/i);
    });

    it("returns no-config guidance for 'No configuration found'", () => {
      const result = classifyError("No configuration found. Please run setup.");
      expect(result).toContain("No hostdoc config found");
    });

    it("returns slug guidance for 'Slug \"x\" already exists'", () => {
      const result = classifyError('Slug "x" already exists');
      expect(result).toMatch(/already taken/i);
    });

    it("returns null for an unrecognized error string", () => {
      expect(classifyError("some unrelated error")).toBeNull();
    });
  });
});
