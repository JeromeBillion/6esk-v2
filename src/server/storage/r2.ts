import { S3Client } from "@aws-sdk/client-s3";

export function createR2Client() {
  if (!process.env.R2_ENDPOINT) {
    throw new Error("R2_ENDPOINT is required");
  }

  return new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? ""
    }
  });
}
