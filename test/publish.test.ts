import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { runPublish } from "../src/commands/publish.js";

const s3mock = mockClient(S3Client);
const cfMock = mockClient(CloudFrontClient);
let dir: string;
beforeEach(() => {
  s3mock.reset();
  s3mock.on(ListObjectsV2Command).resolves({ KeyCount: 0, Contents: [] });
  s3mock.on(PutObjectCommand).resolves({});
  cfMock.reset();
  cfMock.on(CreateInvalidationCommand).resolves({});
  dir = mkdtempSync(join(tmpdir(), "sf-pub-"));
  process.env.HOSTDOC_BUCKET = "b";
  process.env.HOSTDOC_REGION = "us-east-1";
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HOSTDOC_BUCKET;
  delete process.env.HOSTDOC_REGION;
});

describe("runPublish", () => {
  it("uploads a folder under the slug and returns the URL", async () => {
    writeFileSync(join(dir, "index.html"), "<title>Hi</title>");
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "a.css"), "body{}");

    const url = await runPublish({ path: dir, slug: "doc1" });
    expect(url).toBe("http://b.s3-website-us-east-1.amazonaws.com/doc1/");

    const puts = s3mock
      .commandCalls(PutObjectCommand)
      .map((c) => c.args[0].input.Key);
    expect(puts).toContain("doc1/index.html");
    expect(puts).toContain("doc1/assets/a.css");
    expect(puts).toContain("_meta/doc1.json");
  });

  it("rejects an invalid slug", async () => {
    writeFileSync(join(dir, "index.html"), "x");
    await expect(runPublish({ path: dir, slug: "Bad Slug" })).rejects.toThrow(
      /slug/i,
    );
  });

  it("refuses to overwrite an existing slug without --force", async () => {
    s3mock.on(ListObjectsV2Command).resolves({ KeyCount: 1, Contents: [{ Key: "doc1/index.html" }] });
    writeFileSync(join(dir, "index.html"), "x");
    await expect(runPublish({ path: dir, slug: "doc1" })).rejects.toThrow(/force/);
  });

  it("dry-run uploads nothing", async () => {
    writeFileSync(join(dir, "index.html"), "x");
    await runPublish({ path: dir, slug: "doc1", dryRun: true });
    expect(s3mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it("invalidates /<code>/* when overwriting in cloudfront mode", async () => {
    process.env.HOSTDOC_DOMAIN = "shared.example.com";
    process.env.HOSTDOC_DISTRIBUTION = "DIST1";
    s3mock.on(ListObjectsV2Command).resolves({
      KeyCount: 1,
      Contents: [{ Key: "doc1/index.html" }],
      IsTruncated: false,
    });
    writeFileSync(join(dir, "index.html"), "x");

    await runPublish({ path: dir, slug: "doc1", force: true });

    const calls = cfMock.commandCalls(CreateInvalidationCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.InvalidationBatch?.Paths?.Items).toEqual([
      "/doc1/*",
    ]);

    delete process.env.HOSTDOC_DOMAIN;
    delete process.env.HOSTDOC_DISTRIBUTION;
  });

  it("does not invalidate on a fresh publish (no overwrite)", async () => {
    process.env.HOSTDOC_DOMAIN = "shared.example.com";
    process.env.HOSTDOC_DISTRIBUTION = "DIST1";
    writeFileSync(join(dir, "index.html"), "x");

    await runPublish({ path: dir, slug: "fresh1" });

    expect(cfMock.commandCalls(CreateInvalidationCommand)).toHaveLength(0);

    delete process.env.HOSTDOC_DOMAIN;
    delete process.env.HOSTDOC_DISTRIBUTION;
  });
});
