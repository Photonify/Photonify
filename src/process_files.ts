import path from 'path';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';

import { Settings, Files, Sizes } from '@app/types';
import { DEFAULT_SIZES } from '@app/constants';
import { uploadFile } from '@app/upload_file';

export async function processFiles(files: Files, settings: Settings) {
  // Fail early if S3 is selected but not configured
  if (settings.storage === 's3' && (!settings.s3Config || !settings.s3Bucket)) {
    throw new Error(
      'Photonify: S3 storage is selected but s3Config or s3Bucket is not set.'
    );
  }

  const sizes = settings.sizes || DEFAULT_SIZES;
  const outputFormat = settings.outputFormat || 'jpg';
  const outputDest =
    settings.storage === 's3'
      ? path.join(__dirname, '../tmp_for_upload')
      : settings.outputDest || '';

  const createdFiles: string[] = [];
  const resizeOperations: Promise<void>[] = [];

  // Process each file
  const filesArray = Array.isArray(files) ? files : [files];

  for (const file of filesArray) {
    // Process each size for the current file
    for (const [alias, size] of Object.entries(sizes)) {
      const newFileName = `${uuidv4().replace(
        /-/g,
        ''
      )}-${alias}.${outputFormat}`;

      createdFiles.push(newFileName);

      // Create resize operation
      const resizePromise = sharp(file)
        .resize({
          width: size?.width,
          height: size?.height,
        })
        .toFile(path.join(outputDest, newFileName))
        .then(() => {
          // If S3 storage is configured and not in test environment, upload the file
          if (settings.storage === 's3' && process.env.NODE_ENV !== 'test') {
            return uploadFile(
              settings,
              path.join(outputDest, newFileName),
              newFileName
            );
          }
          return Promise.resolve();
        });

      resizeOperations.push(resizePromise);
    }
  }

  try {
    await Promise.all(resizeOperations);

    return {
      createdFiles,
    };
  } catch (error) {
    console.error('Photonify: Error processing images', error);
    throw new Error('Photonify: Error processing images');
  }
}
