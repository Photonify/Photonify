import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';

import { Settings } from '@app/types';

export async function removeFiles(
  fileNames: string[],
  settings: Partial<Settings>
) {
  // Validate inputs
  if (!fileNames || fileNames.length === 0) {
    console.warn('Photonify: No files to delete');
    return;
  }

  if (settings.storage !== 's3' || !settings.s3Config || !settings.s3Bucket) {
    throw new Error(
      'Photonify: Storage must be set to S3 and have s3Config and s3Bucket configured.'
    );
  }

  if (process.env.NODE_ENV === 'test') {
    console.log(
      `Photonify: Skipping S3 delete in test environment for ${fileNames.length} files`
    );
    return;
  }

  const client = new S3Client(settings.s3Config);

  const deleteObjects = fileNames.map(fileName => {
    return {
      Key: fileName,
    };
  });

  const command = new DeleteObjectsCommand({
    Bucket: settings.s3Bucket,
    Delete: {
      Objects: deleteObjects,
    },
  });

  try {
    await client.send(command);

    fileNames.forEach(fileName => {
      console.log(`Photonify S3 Delete: ${fileName}`);
    });
  } catch (error) {
    console.error('Photonify S3 delete error:', error);
    if (error instanceof Error) {
      throw new Error(`Photonify: S3 delete error - ${error.message}`);
    } else {
      throw new Error('Photonify: S3 delete error - Unknown error occurred');
    }
  } finally {
    // Clean up the S3 client
    client.destroy();
  }
}
