import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";

export function makeS3(opts: { region?: string; profile?: string }): S3Client {
  return new S3Client({
    region: opts.region,
    credentials: opts.profile
      ? fromNodeProviderChain({ profile: opts.profile })
      : undefined,
  });
}

export async function putObject(
  s3: S3Client,
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=300",
    }),
  );
}

export async function listKeys(
  s3: S3Client,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

export async function existsPrefix(
  s3: S3Client,
  bucket: string,
  prefix: string,
): Promise<boolean> {
  const res = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1 }),
  );
  return (res.KeyCount ?? 0) > 0;
}

export async function deleteKeys(
  s3: S3Client,
  bucket: string,
  keys: string[],
): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })) },
      }),
    );
  }
}

export async function getJson<T = unknown>(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<T> {
  const res = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (!res.Body) {
    throw new Error(`Empty response body for ${key}`);
  }
  const text = await (res.Body as { transformToString(): Promise<string> }).transformToString();
  return JSON.parse(text) as T;
}
