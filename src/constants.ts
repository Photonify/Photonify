import type { Sizes, SupportedFileTypes } from './types';

export const DEFAULT_SIZES: Sizes = {
  xl: {
    width: 1280,
    height: 801,
  },
  lg: {
    width: 1024,
    height: 768,
  },
  md: {
    width: 640,
    height: 480,
  },
  sm: {
    width: 160,
    height: 144,
  },
};

/** Default number of images processed in parallel. */
export const DEFAULT_CONCURRENCY = 4;

/** S3 DeleteObjects accepts at most 1000 keys per request. */
export const S3_MAX_DELETE_KEYS = 1000;

/** MIME type sent as the S3 object ContentType, keyed by output format. */
export const CONTENT_TYPES: Record<SupportedFileTypes, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  tiff: 'image/tiff',
};

/** sharp's internal format name, keyed by the public output format. */
export const SHARP_FORMATS: Record<
  SupportedFileTypes,
  'jpeg' | 'png' | 'tiff'
> = {
  jpg: 'jpeg',
  png: 'png',
  tiff: 'tiff',
};
