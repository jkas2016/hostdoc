import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { listDocs } from "../src/commands/list.js";

const s3mock = mockClient(S3Client);
beforeEach(() => {
  s3mock.reset();
  process.env.HOSTDOC_BUCKET = "b";
  process.env.HOSTDOC_REGION = "us-east-1";
});
afterEach(() => {
  delete process.env.HOSTDOC_BUCKET;
  delete process.env.HOSTDOC_REGION;
});

describe("listDocs", () => {
  it("reads _meta objects and attaches URLs, newest first", async () => {
    s3mock
      .on(ListObjectsV2Command)
      .resolves({ Contents: [{ Key: "_meta/a.json" }, { Key: "_meta/b.json" }], IsTruncated: false });
    s3mock
      .on(GetObjectCommand, { Key: "_meta/a.json" })
      .resolves({ Body: { transformToString: async () => JSON.stringify({ code: "a", slug: null, title: "A", createdAt: "2026-01-01T00:00:00Z", files: 1, bytes: 1, sourcePath: "/a" }) } as any });
    s3mock
      .on(GetObjectCommand, { Key: "_meta/b.json" })
      .resolves({ Body: { transformToString: async () => JSON.stringify({ code: "b", slug: "b", title: "B", createdAt: "2026-02-01T00:00:00Z", files: 1, bytes: 1, sourcePath: "/b" }) } as any });

    const rows = await listDocs({});
    expect(rows.map((r) => r.code)).toEqual(["b", "a"]); // newest first
    expect(rows[0].url).toBe("http://b.s3-website-us-east-1.amazonaws.com/b/");
  });

  it("skips a corrupt sidecar and still returns the valid ones", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    s3mock
      .on(ListObjectsV2Command)
      .resolves({ Contents: [{ Key: "_meta/a.json" }, { Key: "_meta/bad.json" }], IsTruncated: false });
    s3mock
      .on(GetObjectCommand, { Key: "_meta/a.json" })
      .resolves({ Body: { transformToString: async () => JSON.stringify({ code: "a", slug: null, title: "A", createdAt: "2026-01-01T00:00:00Z", files: 1, bytes: 1, sourcePath: "/a" }) } as any });
    s3mock
      .on(GetObjectCommand, { Key: "_meta/bad.json" })
      .resolves({ Body: { transformToString: async () => "{ not valid json" } as any });

    const rows = await listDocs({});

    expect(rows.map((r) => r.code)).toEqual(["a"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("builds the correct URL for a nested-path code", async () => {
    s3mock
      .on(ListObjectsV2Command)
      .resolves({ Contents: [{ Key: "_meta/team/q1/report.json" }], IsTruncated: false });
    s3mock
      .on(GetObjectCommand, { Key: "_meta/team/q1/report.json" })
      .resolves({ Body: { transformToString: async () => JSON.stringify({ code: "team/q1/report", slug: null, title: "Report", createdAt: "2026-03-01T00:00:00Z", files: 1, bytes: 1, sourcePath: "/report" }) } as any });

    const rows = await listDocs({});
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe("http://b.s3-website-us-east-1.amazonaws.com/team/q1/report/");
  });

  it("skips a sidecar missing createdAt without crashing the sort", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    s3mock
      .on(ListObjectsV2Command)
      .resolves({ Contents: [{ Key: "_meta/a.json" }, { Key: "_meta/nocreate.json" }], IsTruncated: false });
    s3mock
      .on(GetObjectCommand, { Key: "_meta/a.json" })
      .resolves({ Body: { transformToString: async () => JSON.stringify({ code: "a", slug: null, title: "A", createdAt: "2026-01-01T00:00:00Z", files: 1, bytes: 1, sourcePath: "/a" }) } as any });
    s3mock
      .on(GetObjectCommand, { Key: "_meta/nocreate.json" })
      .resolves({ Body: { transformToString: async () => JSON.stringify({ code: "b", slug: null, title: "B", files: 1, bytes: 1, sourcePath: "/b" }) } as any });

    const rows = await listDocs({});

    expect(rows.map((r) => r.code)).toEqual(["a"]);
    warn.mockRestore();
  });
});
