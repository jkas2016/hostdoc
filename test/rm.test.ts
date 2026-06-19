import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { runRm } from "../src/commands/rm.js";

const s3mock = mockClient(S3Client);
const cfMock = mockClient(CloudFrontClient);
beforeEach(() => {
  s3mock.reset();
  cfMock.reset();
  cfMock.on(CreateInvalidationCommand).resolves({});
  process.env.HOSTDOC_BUCKET = "b";
  process.env.HOSTDOC_REGION = "us-east-1";
});
afterEach(() => {
  delete process.env.HOSTDOC_BUCKET;
  delete process.env.HOSTDOC_REGION;
});

describe("runRm", () => {
  it("deletes the prefix objects plus the meta object", async () => {
    s3mock
      .on(ListObjectsV2Command)
      .resolves({ Contents: [{ Key: "doc1/index.html" }, { Key: "doc1/a.css" }], IsTruncated: false });
    s3mock.on(DeleteObjectsCommand).resolves({});

    await runRm({ id: "doc1", yes: true });

    const deleted = s3mock
      .commandCalls(DeleteObjectsCommand)[0]
      .args[0].input.Delete?.Objects?.map((o) => o.Key);
    expect(deleted).toContain("doc1/index.html");
    expect(deleted).toContain("doc1/a.css");
    expect(deleted).toContain("_meta/doc1.json");
  });

  it("throws when the document does not exist", async () => {
    s3mock.on(ListObjectsV2Command).resolves({ Contents: [], IsTruncated: false });
    await expect(runRm({ id: "ghost", yes: true })).rejects.toThrow(/not found/);
  });

  it("invalidates /<id>/* in cloudfront mode", async () => {
    process.env.HOSTDOC_DOMAIN = "shared.example.com";
    process.env.HOSTDOC_DISTRIBUTION = "DIST1";
    s3mock
      .on(ListObjectsV2Command)
      .resolves({ Contents: [{ Key: "doc1/index.html" }], IsTruncated: false });
    s3mock.on(DeleteObjectsCommand).resolves({});

    await runRm({ id: "doc1", yes: true });

    const calls = cfMock.commandCalls(CreateInvalidationCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.InvalidationBatch?.Paths?.Items).toEqual([
      "/doc1/*",
    ]);

    delete process.env.HOSTDOC_DOMAIN;
    delete process.env.HOSTDOC_DISTRIBUTION;
  });
});
