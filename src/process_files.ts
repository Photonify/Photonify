import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { S3Client } from '@aws-sdk/client-s3';

import { Settings, Files, SupportedFileTypes } from './types';
import {
  DEFAULT_SIZES,
  DEFAULT_CONCURRENCY,
  CONTENT_TYPES,
  SHARP_FORMATS,
} from './constants';
import { uploadFile } from './upload_file';

export type ProcessResult = {
  createdFiles: string[];
};

type Task = {
  file: Buffer;
  alias: string;
  width?: number;
  height?: number;
};

export async function processFiles(
  files: Files,
  settings: Settings
): Promise<ProcessResult> {
  const isS3 = settings.storage === 's3';

  if (isS3 && (!settings.s3Config || !settings.s3Bucket)) {
    throw new Error(
      'Photonify: S3 storage is selected but s3Config or s3Bucket is not set.'
    );
  }

  if (!isS3 && !settings.outputDest) {
    throw new Error('Photonify: outputDest is required for local storage.');
  }

  const sizes = settings.sizes ?? DEFAULT_SIZES;
  const outputFormat: SupportedFileTypes = settings.outputFormat ?? 'jpg';
  if (!CONTENT_TYPES[outputFormat]) {
    throw new Error(`Photonify: Unsupported output format "${outputFormat}".`);
  }
  const concurrency = Math.max(1, settings.concurrency ?? DEFAULT_CONCURRENCY);

  const filesArray = Array.isArray(files) ? files : [files];

  // Build the full task list: one entry per (image x size).
  const tasks: Task[] = [];
  for (const file of filesArray) {
    for (const [alias, size] of Object.entries(sizes)) {
      tasks.push({ file, alias, width: size?.width, height: size?.height });
    }
  }

  if (!isS3) {
    fs.mkdirSync(settings.outputDest as string, { recursive: true });
  }

  const client = isS3 ? new S3Client(settings.s3Config ?? {}) : undefined;
  const createdFiles: string[] = new Array(tasks.length);
  const writtenLocalPaths: string[] = [];

  const runTask = async (index: number): Promise<void> => {
    const { file, alias, width, height } = tasks[index];
    const fileName = `${uuidv4().replace(/-/g, '')}-${alias}.${outputFormat}`;

    const pipeline = sharp(file)
      .resize({ width, height, fit: settings.fit })
      .toFormat(SHARP_FORMATS[outputFormat]);

    if (isS3) {
      const buffer = await pipeline.toBuffer();
      await uploadFile(
        client as S3Client,
        settings.s3Bucket as string,
        fileName,
        buffer,
        CONTENT_TYPES[outputFormat]
      );
    } else {
      const dest = path.join(settings.outputDest as string, fileName);
      await pipeline.toFile(dest);
      writtenLocalPaths.push(dest);
    }

    createdFiles[index] = fileName;
  };

  try {
    // Concurrency-limited worker pool over the shared task index.
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < tasks.length) {
        const current = next;
        next += 1;
        await runTask(current);
      }
    };
    const workerCount = Math.min(concurrency, tasks.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    return { createdFiles };
  } catch (error) {
    // Best-effort cleanup of anything already written locally.
    for (const filePath of writtenLocalPaths) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // ignore cleanup failures
      }
    }
    const wrapped = new Error('Photonify: Error processing images') as Error & {
      cause?: unknown;
    };
    wrapped.cause = error;
    throw wrapped;
  } finally {
    client?.destroy();
  }
}
