import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";

// CloudFront is a global service reached through the us-east-1 endpoint.
export function makeCloudFront(opts: { profile?: string }): CloudFrontClient {
  return new CloudFrontClient({
    region: "us-east-1",
    credentials: opts.profile
      ? fromNodeProviderChain({ profile: opts.profile })
      : undefined,
  });
}

const THROTTLE_NAMES = new Set([
  "Throttling",
  "ThrottlingException",
  "TooManyInvalidationsInProgress",
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function invalidate(
  cf: CloudFrontClient,
  distributionId: string,
  paths: string[],
  opts: { maxRetries?: number; baseDelayMs?: number } = {},
): Promise<void> {
  const maxRetries = opts.maxRetries ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  for (let attempt = 0; ; attempt++) {
    try {
      await cf.send(
        new CreateInvalidationCommand({
          DistributionId: distributionId,
          InvalidationBatch: {
            CallerReference: `hostdoc-${Date.now()}-${attempt}`,
            Paths: { Quantity: paths.length, Items: paths },
          },
        }),
      );
      return;
    } catch (err) {
      const name = (err as { name?: string }).name ?? "";
      if (!THROTTLE_NAMES.has(name) || attempt >= maxRetries) throw err;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
}
