import fs from 'fs';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Settings } from '@app/types';

export async function uploadFile(
  settings: Settings,
  pathToFile: string,
  newFileName: string
): Promise<void> {
  // Validate inputs
  if (!settings || !settings.s3Config || !settings.s3Bucket) {
    throw new Error('Photonify: S3 configuration is missing');
  }

  if (!pathToFile || !newFileName) {
    throw new Error('Photonify: File path or filename is missing');
  }

  try {
    // Read file content
    const file = fs.readFileSync(pathToFile);

    // Create S3 client
    const client = new S3Client(settings.s3Config);

    // Create upload command
    const command = new PutObjectCommand({
      Bucket: settings.s3Bucket,
      Key: newFileName,
      Body: file,
    });

    // Upload file to S3
    await client.send(command);

    // Delete temp file after upload completes
    fs.unlinkSync(pathToFile);

    console.log(`Photonify S3 Upload: ${newFileName}`);
  } catch (err) {
    console.error('Photonify: S3 upload error');
    console.error(err);
    throw err; // Re-throw the error so calling code can handle it
  }
}
