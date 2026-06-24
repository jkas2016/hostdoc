import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { runRm } from "../src/commands/rm.js";
import { confirm } from "../src/lib/prompt.js";

vi.mock("../src/lib/prompt.js", () => ({ confirm: vi.fn() }));
const confirmMock = vi.mocked(confirm);

const s3mock = mockClient(S3Client);
const cfMock = mockClient(CloudFrontClient);

let origTTY: boolean | undefined;
function setTTY(v: boolean): void {
  process.stdin.isTTY = v;
}

beforeEach(() => {
  s3mock.reset();
  cfMock.reset();
  cfMock.on(CreateInvalidationCommand).resolves({});
  confirmMock.mockReset();
  origTTY = process.stdin.isTTY;
  process.env.HOSTDOC_BUCKET = "b";
  process.env.HOSTDOC_REGION = "us-east-1";
});
afterEach(() => {
  process.stdin.isTTY = origTTY;
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

  it.each(["_meta", "../escape", "a b", "Doc1", "x/y", "x?y"])(
    "rejects invalid id %j before deleting anything",
    async (id) => {
      s3mock.on(ListObjectsV2Command).resolves({ Contents: [], IsTruncated: false });
      s3mock.on(DeleteObjectsCommand).resolves({});

      await expect(runRm({ id, yes: true })).rejects.toThrow(/invalid id/i);
      expect(s3mock.commandCalls(DeleteObjectsCommand)).toHaveLength(0);
      expect(s3mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);
    },
  );

  it("prompts for confirmation and aborts without deleting when declined", async () => {
    setTTY(true);
    confirmMock.mockResolvedValue(false);
    s3mock
      .on(ListObjectsV2Command)
      .resolves({ Contents: [{ Key: "doc1/index.html" }], IsTruncated: false });
    s3mock.on(DeleteObjectsCommand).resolves({});

    await expect(runRm({ id: "doc1" })).rejects.toThrow(/aborted/i);

    expect(confirmMock).toHaveBeenCalledOnce();
    expect(s3mock.commandCalls(DeleteObjectsCommand)).toHaveLength(0);
  });

  it("deletes when confirmation is accepted", async () => {
    setTTY(true);
    confirmMock.mockResolvedValue(true);
    s3mock
      .on(ListObjectsV2Command)
      .resolves({ Contents: [{ Key: "doc1/index.html" }], IsTruncated: false });
    s3mock.on(DeleteObjectsCommand).resolves({});

    await runRm({ id: "doc1" });

    expect(confirmMock).toHaveBeenCalledOnce();
    expect(s3mock.commandCalls(DeleteObjectsCommand)).toHaveLength(1);
  });

  it("refuses to delete without --yes when stdin is not a TTY", async () => {
    setTTY(false);
    s3mock
      .on(ListObjectsV2Command)
      .resolves({ Contents: [{ Key: "doc1/index.html" }], IsTruncated: false });
    s3mock.on(DeleteObjectsCommand).resolves({});

    await expect(runRm({ id: "doc1" })).rejects.toThrow(/--yes/);

    expect(confirmMock).not.toHaveBeenCalled();
    expect(s3mock.commandCalls(DeleteObjectsCommand)).toHaveLength(0);
  });
});
