import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import { makeCloudFront, invalidate } from "../src/lib/cloudfront.js";

const cfMock = mockClient(CloudFrontClient);
beforeEach(() => cfMock.reset());

describe("invalidate", () => {
  it("creates an invalidation for the given paths", async () => {
    cfMock.on(CreateInvalidationCommand).resolves({});
    const cf = makeCloudFront({});
    await invalidate(cf, "DIST123", ["/abc/*"]);

    const input = cfMock.commandCalls(CreateInvalidationCommand)[0].args[0].input;
    expect(input.DistributionId).toBe("DIST123");
    expect(input.InvalidationBatch?.Paths?.Items).toEqual(["/abc/*"]);
    expect(input.InvalidationBatch?.Paths?.Quantity).toBe(1);
  });

  it("retries on throttling then succeeds", async () => {
    const err = Object.assign(new Error("rate"), {
      name: "TooManyInvalidationsInProgress",
    });
    cfMock.on(CreateInvalidationCommand).rejectsOnce(err).resolves({});
    const cf = makeCloudFront({});
    await invalidate(cf, "DIST123", ["/abc/*"], { baseDelayMs: 0 });
    expect(cfMock.commandCalls(CreateInvalidationCommand)).toHaveLength(2);
  });
});
