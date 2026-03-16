import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Client, getR2BucketName } from "../config/r2";
import { randomUUID } from "crypto";

const ALLOWED_EXT = new Set(["pdf", "jpg", "jpeg"]);
const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
]);

/**
 * Upload a file buffer to R2 and return the object key (path).
 * Key format: documents/{requirement_id}/{uuid}.{ext}
 */
export async function uploadDocumentToR2(
  requirementId: string,
  buffer: Buffer,
  originalName: string,
  contentType: string
): Promise<string> {
  const ext = originalName.split(".").pop()?.toLowerCase();
  if (!ext || !ALLOWED_EXT.has(ext)) {
    throw new Error("Allowed file types: PDF, JPG");
  }
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new Error("Allowed content types: application/pdf, image/jpeg");
  }

  const key = `documents/${requirementId}/${randomUUID()}.${ext}`;
  const client = getR2Client();
  const bucket = getR2BucketName();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  return key;
}

/** Generate a presigned GET URL for an R2 object key. Expires in 1 hour. */
export async function getDocumentPresignedUrl(key: string): Promise<string> {
  const client = getR2Client();
  const bucket = getR2BucketName();
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(client, command, { expiresIn: 3600 });
}
