import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Readable } from "stream";

const globalForR2 = globalThis as unknown as { r2Client?: S3Client };

export function getR2Client() {
  if (globalForR2.r2Client) {
    return globalForR2.r2Client;
  }

  if (!process.env.R2_ENDPOINT) {
    throw new Error("R2_ENDPOINT is required");
  }

  const client = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? ""
    }
  });

  if (process.env.NODE_ENV !== "production") {
    globalForR2.r2Client = client;
  }

  return client;
}

export async function putObject({
  key,
  body,
  contentType
}: {
  key: string;
  body: Buffer | string;
  contentType?: string;
}) {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) {
    throw new Error("R2_BUCKET is required");
  }

  const client = getR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType
    })
  );

  return key;
}

export async function getObjectBuffer(key: string) {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) {
    throw new Error("R2_BUCKET is required");
  }

  const client = getR2Client();
  const result = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key
    })
  );

  const body = result.Body as Readable | undefined;
  if (!body) {
    return { buffer: Buffer.alloc(0), contentType: result.ContentType ?? undefined };
  }

  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return {
    buffer: Buffer.concat(chunks),
    contentType: result.ContentType ?? undefined
  };
}

export async function deleteObject(key: string) {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) {
    throw new Error("R2_BUCKET is required");
  }

  const client = getR2Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key
    })
  );
}
