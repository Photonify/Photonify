import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';

import { RemoveSettings } from './types';
import { S3_MAX_DELETE_KEYS } from './constants';
import { PhotonifyError } from './errors';

export async function removeFiles(
  fileNames: string[],
  settings: RemoveSettings
): Promise<void> {
  if (!fileNames || fileNames.length === 0) {
    return;
  }

  if (settings.storage !== 's3' || !settings.s3Config || !settings.s3Bucket) {
    throw new PhotonifyError(
      'Photonify: Storage must be set to S3 and have s3Config and s3Bucket configured.'
    );
  }

  const client = new S3Client(settings.s3Config);

  try {
    // S3 DeleteObjects accepts at most 1000 keys per request, so batch.
    for (let i = 0; i < fileNames.length; i += S3_MAX_DELETE_KEYS) {
      const batch = fileNames.slice(i, i + S3_MAX_DELETE_KEYS);

      const response = await client.send(
        new DeleteObjectsCommand({
          Bucket: settings.s3Bucket,
          // Quiet omits the (large) list of successfully deleted keys from the
          // response; only per-key Errors come back, which is all we inspect.
          Delete: { Objects: batch.map(Key => ({ Key })), Quiet: true },
        })
      );

      // DeleteObjects can succeed at the request level while reporting
      // per-key failures in the response body.
      if (response.Errors && response.Errors.length > 0) {
        const details = response.Errors.map(
          err => `${err.Key} (${err.Message})`
        ).join(', ');
        throw new PhotonifyError(
          `Photonify: S3 delete failed for - ${details}`
        );
      }
    }
  } catch (error) {
    // Pass our own errors through untouched; wrap transport/SDK errors with the
    // original attached as `cause`.
    if (error instanceof PhotonifyError) {
      throw error;
    }
    throw new PhotonifyError('Photonify: S3 delete error', { cause: error });
  } finally {
    client.destroy();
  }
}
