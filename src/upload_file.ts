import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * Upload a single image buffer to S3. The caller owns the client's lifecycle
 * (creation and destruction) so it can be shared across many uploads.
 */
export async function uploadFile(
  client: S3Client,
  bucket: string,
  key: string,
  body: Buffer,
  contentType?: string
): Promise<void> {
  if (!bucket) {
    throw new Error('Photonify: S3 bucket is missing');
  }

  if (!key || !body) {
    throw new Error('Photonify: File body or key is missing');
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}
