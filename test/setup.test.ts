import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  S3Client,
  CreateBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketWebsiteCommand,
  PutBucketPolicyCommand,
} from "@aws-sdk/client-s3";
import { runSetup } from "../src/commands/setup.js";
import { loadConfig } from "../src/lib/config.js";

const s3mock = mockClient(S3Client);
let dir: string;
beforeEach(() => {
  s3mock.reset();
  s3mock.onAnyCommand().resolves({});
  dir = mkdtempSync(join(tmpdir(), "sf-setup-"));
  process.env.XDG_CONFIG_HOME = dir;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("runSetup", () => {
  it("omits LocationConstraint for us-east-1 and writes config", async () => {
    const cfg = await runSetup({ bucket: "mybk", region: "us-east-1" });

    const create = s3mock.commandCalls(CreateBucketCommand)[0].args[0].input;
    expect(create.Bucket).toBe("mybk");
    expect(create.CreateBucketConfiguration).toBeUndefined();

    expect(s3mock.commandCalls(PutPublicAccessBlockCommand)).toHaveLength(1);
    expect(s3mock.commandCalls(PutBucketWebsiteCommand)).toHaveLength(1);

    const policy = JSON.parse(
      s3mock.commandCalls(PutBucketPolicyCommand)[0].args[0].input.Policy!,
    );
    const sids = policy.Statement.map((s: { Sid: string }) => s.Sid);
    expect(sids).toContain("PublicReadGetObject");
    expect(sids).toContain("DenyMetaPrefix");

    expect(cfg.mode).toBe("s3-website");
    expect(loadConfig()).toEqual(cfg);
  });

  it("sets LocationConstraint for non us-east-1 regions", async () => {
    await runSetup({ bucket: "mybk", region: "ap-northeast-2" });
    const create = s3mock.commandCalls(CreateBucketCommand)[0].args[0].input;
    expect(create.CreateBucketConfiguration).toEqual({
      LocationConstraint: "ap-northeast-2",
    });
  });
});
