import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { inspect } from 'util';
import sharp from 'sharp';
import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';

import {
  Settings,
  Files,
  Size,
  SupportedFileTypes,
  ProcessResult,
} from './types';
import {
  DEFAULT_SIZES,
  DEFAULT_CONCURRENCY,
  CONTENT_TYPES,
  SHARP_FORMATS,
  S3_MAX_DELETE_KEYS,
  S3_ROLLBACK_TIMEOUT_MS,
  SIZE_ALIAS_PATTERN,
} from './constants';
import { PhotonifyError } from './errors';
import { uploadFile } from './upload_file';

export type { ProcessResult };

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
    throw new PhotonifyError(
      `Photonify: Invalid size alias "${alias}". Aliases may only contain letters, digits, "_" and "-".`
    );
  }
  if (!size || (size.width === undefined && size.height === undefined)) {
    throw new PhotonifyError(
      `Photonify: Size "${alias}" must specify a width, a height, or both.`
    );
  }
  for (const dimension of ['width', 'height'] as const) {
    const value = size[dimension];
    if (value !== undefined && !isPositiveInteger(value)) {
      throw new PhotonifyError(
        `Photonify: Size "${alias}" has an invalid ${dimension} (${inspect(value)}); expected a positive integer.`
      );
    }
  }
}

export async function processFiles(
  files: Files,
  settings: Settings
): Promise<ProcessResult> {
  if (
    settings.storage !== undefined &&
    settings.storage !== 'local' &&
    settings.storage !== 's3'
  ) {
    throw new PhotonifyError(
      `Photonify: Unknown storage ${inspect(settings.storage)}; expected 'local' or 's3'.`
    );
  }

  const isS3 = settings.storage === 's3';

  if (isS3 && (!settings.s3Config || !settings.s3Bucket)) {
    throw new PhotonifyError(
      'Photonify: S3 storage is selected but s3Config or s3Bucket is not set.'
    );
  }

  if (!isS3 && !settings.outputDest) {
    throw new PhotonifyError(
      'Photonify: outputDest is required for local storage.'
    );
  }

  const sizes = settings.sizes ?? DEFAULT_SIZES;
  const sizeEntries = Object.entries(sizes);
  if (sizeEntries.length === 0) {
    throw new PhotonifyError(
      'Photonify: sizes must contain at least one entry.'
    );
  }
  for (const [alias, size] of sizeEntries) {
    validateSize(alias, size);
  }

  const outputFormat: SupportedFileTypes = settings.outputFormat ?? 'jpg';
  // hasOwnProperty (not truthiness) so inherited keys like 'toString' or
  // '__proto__' are rejected instead of passing the check.
  if (!Object.prototype.hasOwnProperty.call(CONTENT_TYPES, outputFormat)) {
    throw new PhotonifyError(
      `Photonify: Unsupported output format ${inspect(settings.outputFormat)}; expected one of ${Object.keys(CONTENT_TYPES).join(', ')}.`
    );
  }

  // Infinity is accepted and means "no limit" (one worker per task).
  const concurrency = settings.concurrency ?? DEFAULT_CONCURRENCY;
  if (!isPositiveInteger(concurrency) && concurrency !== Infinity) {
    throw new PhotonifyError(
      `Photonify: concurrency must be a positive integer or Infinity (received ${inspect(settings.concurrency)}).`
    );
  }

  // An empty array is a valid no-op (produces no files); non-Buffer entries are
  // rejected up front so they surface clearly rather than as a wrapped sharp error.
  const filesArray = Array.isArray(files) ? files : [files];
  filesArray.forEach((file, index) => {
    if (!Buffer.isBuffer(file)) {
      throw new PhotonifyError(
        `Photonify: files[${index}] is not a Buffer (received ${inspect(file, { maxStringLength: 40, depth: 1 })}).`
      );
    }
  });

  // Build the full task list: one entry per (image x size).
  const tasks: Task[] = [];
  for (const file of filesArray) {
    for (const [alias, size] of sizeEntries) {
      tasks.push({ file, alias, width: size.width, height: size.height });
    }
  }

  const outputDest = settings.outputDest as string;
  const s3Bucket = settings.s3Bucket as string;

  if (!isS3) {
    try {
      await fs.promises.mkdir(outputDest, { recursive: true });
    } catch (error) {
      // Keep the "every rejection is a PhotonifyError" guarantee: mkdir can
      // fail with EACCES, ENOTDIR, or EEXIST (outputDest is an existing file).
      throw new PhotonifyError(
        `Photonify: Could not create outputDest ${inspect(outputDest)}.`,
        { cause: error }
      );
    }
  }

  const client = isS3 ? new S3Client(settings.s3Config ?? {}) : undefined;
  const createdFiles: string[] = new Array<string>(tasks.length);
  const writtenLocalPaths: string[] = [];
  const uploadedKeys: string[] = [];

  const runTask = async (index: number): Promise<void> => {
    const { file, alias, width, height } = tasks[index];
    const fileName = `${randomUUID().replace(/-/g, '')}-${alias}.${outputFormat}`;

    // rotate() with no argument applies the EXIF orientation so the output
    // pixels are upright; sharp strips the EXIF tag itself on output.
    const pipeline = sharp(file)
      .rotate()
      .resize({
        width,
        height,
        fit: settings.fit,
        withoutEnlargement: settings.withoutEnlargement,
      })
      // force: true overrides any caller-supplied force so the output is always
      // re-encoded to outputFormat; force: false would keep the input format
      // while we still name the file and set the S3 ContentType for outputFormat.
      .toFormat(SHARP_FORMATS[outputFormat], {
        ...settings.formatOptions,
        force: true,
      });

    // Record the destination *before* the write so that a write which fails
    // after partially succeeding (a PutObject whose response is lost after S3
    // stored the body, a toFile interrupted mid-write) is still rolled back.
    // Cleanup tolerates keys/paths that never materialised.
    if (isS3) {
      const buffer = await pipeline.toBuffer();
      uploadedKeys.push(fileName);
      await uploadFile(
        client as S3Client,
        s3Bucket,
        fileName,
        buffer,
        CONTENT_TYPES[outputFormat]
      );
    } else {
      const dest = path.join(outputDest, fileName);
      writtenLocalPaths.push(dest);
      await pipeline.toFile(dest);
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
            }),
            // Time-bound the rollback so an S3 outage cannot add the SDK's full
            // retry latency before the caller sees the original failure.
            { abortSignal: AbortSignal.timeout(S3_ROLLBACK_TIMEOUT_MS) }
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
      throw new PhotonifyError('Photonify: Error processing images', {
        cause: failure.error,
      });
    }

    return { createdFiles };
  } finally {
    client?.destroy();
  }
}
