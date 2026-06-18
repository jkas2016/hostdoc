import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import {
  makeS3,
  putObject,
  listKeys,
  deleteKeys,
  existsPrefix,
  getJson,
} from "../src/lib/aws.js";

const s3mock = mockClient(S3Client);
beforeEach(() => s3mock.reset());

describe("aws helpers", () => {
  it("putObject sends ContentType + CacheControl", async () => {
    s3mock.on(PutObjectCommand).resolves({});
    const s3 = makeS3({ region: "us-east-1" });
    await putObject(s3, "b", "k/index.html", Buffer.from("x"), "text/html");
    const call = s3mock.commandCalls(PutObjectCommand)[0].args[0].input;
    expect(call.Bucket).toBe("b");
    expect(call.Key).toBe("k/index.html");
    expect(call.ContentType).toBe("text/html");
    expect(call.CacheControl).toMatch(/max-age/);
  });

  it("listKeys paginates", async () => {
    s3mock
      .on(ListObjectsV2Command)
      .resolvesOnce({ Contents: [{ Key: "a" }], IsTruncated: true, NextContinuationToken: "t" })
      .resolvesOnce({ Contents: [{ Key: "b" }], IsTruncated: false });
    const keys = await listKeys(makeS3({ region: "us-east-1" }), "b", "p/");
    expect(keys).toEqual(["a", "b"]);
  });

  it("existsPrefix is true when KeyCount > 0", async () => {
    s3mock.on(ListObjectsV2Command).resolves({ KeyCount: 1 });
    expect(await existsPrefix(makeS3({ region: "us-east-1" }), "b", "p/")).toBe(true);
  });

  it("deleteKeys batches Objects", async () => {
    s3mock.on(DeleteObjectsCommand).resolves({});
    await deleteKeys(makeS3({ region: "us-east-1" }), "b", ["a", "b"]);
    const input = s3mock.commandCalls(DeleteObjectsCommand)[0].args[0].input;
    expect(input.Delete?.Objects).toEqual([{ Key: "a" }, { Key: "b" }]);
  });

  it("getJson parses the body", async () => {
    s3mock.on(GetObjectCommand).resolves({
      Body: { transformToString: async () => JSON.stringify({ ok: 1 }) } as any,
    });
    const v = await getJson(makeS3({ region: "us-east-1" }), "b", "k.json");
    expect(v).toEqual({ ok: 1 });
  });
});
