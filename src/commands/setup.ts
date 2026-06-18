import {
  CreateBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketWebsiteCommand,
  PutBucketPolicyCommand,
  type BucketLocationConstraint,
} from "@aws-sdk/client-s3";
import { makeS3 } from "../lib/aws.js";
import { saveConfig, type Config } from "../lib/config.js";
import { websiteEndpoint } from "../lib/url.js";

export async function runSetup(args: {
  bucket: string;
  region: string;
  profile?: string;
}): Promise<Config> {
  const { bucket, region, profile } = args;
  const s3 = makeS3({ region, profile });

  try {
    await s3.send(
      new CreateBucketCommand({
        Bucket: bucket,
        ...(region !== "us-east-1"
          ? { CreateBucketConfiguration: { LocationConstraint: region as BucketLocationConstraint } }
          : {}),
      }),
    );
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name !== "BucketAlreadyOwnedByYou") throw err;
  }

  await s3.send(
    new PutPublicAccessBlockCommand({
      Bucket: bucket,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: false,
        IgnorePublicAcls: false,
        BlockPublicPolicy: false,
        RestrictPublicBuckets: false,
      },
    }),
  );

  await s3.send(
    new PutBucketWebsiteCommand({
      Bucket: bucket,
      WebsiteConfiguration: {
        IndexDocument: { Suffix: "index.html" },
        ErrorDocument: { Key: "index.html" },
      },
    }),
  );

  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "PublicReadGetObject",
        Effect: "Allow",
        Principal: "*",
        Action: "s3:GetObject",
        Resource: `arn:aws:s3:::${bucket}/*`,
      },
      {
        Sid: "DenyMetaPrefix",
        Effect: "Deny",
        Principal: "*",
        Action: "s3:GetObject",
        Resource: `arn:aws:s3:::${bucket}/_meta/*`,
      },
    ],
  };
  await s3.send(
    new PutBucketPolicyCommand({ Bucket: bucket, Policy: JSON.stringify(policy) }),
  );

  const cfg: Config = {
    mode: "s3-website",
    bucket,
    region,
    websiteEndpoint: websiteEndpoint(bucket, region),
  };
  saveConfig(cfg);
  return cfg;
}
