import type { Sizes, SupportedFileTypes } from './types';

/**
 * Default output sizes. Each specifies only a width, so the height is derived
 * from the source aspect ratio and images are never cropped or stretched.
 */
export const DEFAULT_SIZES: Sizes = {
  xl: { width: 1280 },
  lg: { width: 1024 },
  md: { width: 640 },
  sm: { width: 320 },
};

/** Default number of (image x size) tasks processed in parallel. */
export const DEFAULT_CONCURRENCY = 4;

/** S3 DeleteObjects accepts at most 1000 keys per request. */
export const S3_MAX_DELETE_KEYS = 1000;

/**
 * Upper bound on the best-effort S3 rollback that runs after a failed
 * processFiles call, so an S3 outage cannot add the SDK's full retry latency
 * before the caller sees the original rejection.
 */
export const S3_ROLLBACK_TIMEOUT_MS = 10_000;

/** MIME type sent as the S3 object ContentType, keyed by output format. */
export const CONTENT_TYPES: Record<SupportedFileTypes, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  tiff: 'image/tiff',
  webp: 'image/webp',
  avif: 'image/avif',
};

/** sharp's internal format name, keyed by the public output format. */
export const SHARP_FORMATS: Record<
  SupportedFileTypes,
  'jpeg' | 'png' | 'tiff' | 'webp' | 'avif'
> = {
  jpg: 'jpeg',
  png: 'png',
  tiff: 'tiff',
  webp: 'webp',
  avif: 'avif',
};

/**
 * Size aliases become part of the output filename / S3 key, so restrict them
 * to characters that cannot introduce path separators or traversal.
 */
export const SIZE_ALIAS_PATTERN = /^[A-Za-z0-9_-]+$/;
