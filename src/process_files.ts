import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';

import { Settings, Files, Size, SupportedFileTypes } from './types';
import {
  DEFAULT_SIZES,
  DEFAULT_CONCURRENCY,
  CONTENT_TYPES,
  SHARP_FORMATS,
  S3_MAX_DELETE_KEYS,
  SIZE_ALIAS_PATTERN,
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

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function validateSize(alias: string, size: Size | undefined): void {
  if (!SIZE_ALIAS_PATTERN.test(alias)) {
    throw new Error(
      `Photonify: Invalid size alias "${alias}". Aliases may only contain letters, digits, "_" and "-".`
    );
  }
  if (!size || (size.width === undefined && size.height === undefined)) {
    throw new Error(
      `Photonify: Size "${alias}" must specify a width, a height, or both.`
    );
  }
  for (const dimension of ['width', 'height'] as const) {
    const value = size[dimension];
    if (value !== undefined && !isPositiveInteger(value)) {
      throw new Error(
        `Photonify: Size "${alias}" has an invalid ${dimension} (${String(value)}); expected a positive integer.`
      );
    }
  }
}

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
  for (const [alias, size] of Object.entries(sizes)) {
    validateSize(alias, size);
  }

  const outputFormat: SupportedFileTypes = settings.outputFormat ?? 'jpg';
  if (!CONTENT_TYPES[outputFormat]) {
    throw new Error(`Photonify: Unsupported output format "${outputFormat}".`);
  }

  const concurrency = settings.concurrency ?? DEFAULT_CONCURRENCY;
  if (!isPositiveInteger(concurrency)) {
    throw new Error(
      `Photonify: concurrency must be a positive integer (received ${String(settings.concurrency)}).`
    );
  }

  const filesArray = Array.isArray(files) ? files : [files];

  // Build the full task list: one entry per (image x size).
  const tasks: Task[] = [];
  for (const file of filesArray) {
    for (const [alias, size] of Object.entries(sizes)) {
      tasks.push({ file, alias, width: size.width, height: size.height });
    }
  }

  const outputDest = settings.outputDest as string;
  const s3Bucket = settings.s3Bucket as string;

  if (!isS3) {
    await fs.promises.mkdir(outputDest, { recursive: true });
  }

  const client = isS3 ? new S3Client(settings.s3Config ?? {}) : undefined;
  const createdFiles: string[] = new Array(tasks.length);
  const writtenLocalPaths: string[] = [];
  const uploadedKeys: string[] = [];

  const runTask = async (index: number): Promise<void> => {
    const { file, alias, width, height } = tasks[index];
    const fileName = `${uuidv4().replace(/-/g, '')}-${alias}.${outputFormat}`;

    // rotate() with no argument applies the EXIF orientation so the output
    // pixels are upright; sharp strips the EXIF tag itself on output.
    const pipeline = sharp(file)
      .rotate()
      .resize({ width, height, fit: settings.fit })
      .toFormat(SHARP_FORMATS[outputFormat]);

    if (isS3) {
      const buffer = await pipeline.toBuffer();
      await uploadFile(
        client as S3Client,
        s3Bucket,
        fileName,
        buffer,
        CONTENT_TYPES[outputFormat]
      );
      uploadedKeys.push(fileName);
    } else {
      const dest = path.join(outputDest, fileName);
      await pipeline.toFile(dest);
      writtenLocalPaths.push(dest);
    }

    createdFiles[index] = fileName;
  };

  const cleanup = async (): Promise<void> => {
    // Best-effort: remove everything this call produced, ignoring failures.
    await Promise.all(
      writtenLocalPaths.map(filePath =>
        fs.promises.unlink(filePath).catch(() => undefined)
      )
    );

    if (client && uploadedKeys.length > 0) {
      for (let i = 0; i < uploadedKeys.length; i += S3_MAX_DELETE_KEYS) {
        const batch = uploadedKeys.slice(i, i + S3_MAX_DELETE_KEYS);
        try {
          await client.send(
            new DeleteObjectsCommand({
              Bucket: s3Bucket,
              Delete: { Objects: batch.map(Key => ({ Key })), Quiet: true },
            })
          );
        } catch {
          // ignore cleanup failures
        }
      }
    }
  };

  try {
    // Concurrency-limited worker pool over the shared task index. Workers
    // never reject: the first failure is recorded and stops further scheduling,
    // and every in-flight task is awaited before cleanup runs so no file is
    // written or uploaded after cleanup has already happened.
    let next = 0;
    let failure: { error: unknown } | undefined;

    const worker = async (): Promise<void> => {
      while (!failure && next < tasks.length) {
        const current = next;
        next += 1;
        try {
          await runTask(current);
        } catch (error) {
          failure ??= { error };
        }
      }
    };

    const workerCount = Math.min(concurrency, tasks.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    if (failure) {
      await cleanup();
      const wrapped = new Error(
        'Photonify: Error processing images'
      ) as Error & { cause?: unknown };
      wrapped.cause = failure.error;
      throw wrapped;
    }

    return { createdFiles };
  } finally {
    client?.destroy();
  }
}
