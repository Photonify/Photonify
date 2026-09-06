import type { S3ClientConfig } from '@aws-sdk/client-s3';
import type * as sharp from 'sharp';

export type Size = {
  width?: number;
  height?: number;
};

/**
 * A map of size alias -> dimensions. Aliases are arbitrary (the built-in
 * defaults are xl/lg/md/sm). Provide width, height, or both; when only one is
 * given the other is derived from the source aspect ratio.
 */
export type Sizes = Record<string, Size>;

/** sharp resize strategies. See https://sharp.pixelplumbing.com/api-resize */
export type Fit = 'contain' | 'cover' | 'fill' | 'inside' | 'outside';

export type SupportedFileTypes = 'jpg' | 'png' | 'tiff' | 'webp' | 'avif';

/**
 * Encoder options passed straight to sharp's `toFormat(format, options)` for the
 * chosen `outputFormat`. It is the intersection of sharp's per-format option
 * types, so a field only applies when it is meaningful for that format (e.g.
 * `quality` for jpeg/webp/avif, `compressionLevel` for png). Only the options
 * relevant to the active format are read.
 */
export type FormatOptions = sharp.OutputOptions &
  sharp.JpegOptions &
  sharp.PngOptions &
  sharp.WebpOptions &
  sharp.AvifOptions &
  sharp.TiffOptions;

export type Settings = {
  outputDest?: string;
  storage?: 'local' | 's3';
  outputFormat?: SupportedFileTypes;
  sizes?: Sizes;
  /** How images are fit into the target dimensions. Defaults to sharp's 'cover'. */
  fit?: Fit;
  /**
   * When true, images smaller than a target size are left at their original
   * size rather than being upscaled to fill the box. Defaults to false (sharp's
   * default), which enlarges small images.
   */
  withoutEnlargement?: boolean;
  /** Encoder options for the chosen `outputFormat` (e.g. `{ quality: 90 }`). */
  formatOptions?: FormatOptions;
  /** Max number of (image x size) tasks processed in parallel. Must be a positive integer, or Infinity for no limit. Defaults to 4. */
  concurrency?: number;
  s3Config?: S3ClientConfig;
  s3Bucket?: string;
};

/**
 * Settings for `removeFiles`. Deletion only targets S3, so `storage`,
 * `s3Config`, and `s3Bucket` are all required.
 */
export type RemoveSettings = {
  storage: 's3';
  s3Config: S3ClientConfig;
  s3Bucket: string;
};

export type Files = Buffer | Buffer[];

/** The result of a successful `processFiles` call. */
export type ProcessResult = {
  createdFiles: string[];
};
