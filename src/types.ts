import type { S3ClientConfig } from '@aws-sdk/client-s3';

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

export type SupportedFileTypes = 'jpg' | 'png' | 'tiff';

export type Settings = {
  outputDest?: string;
  storage?: 'local' | 's3';
  outputFormat?: SupportedFileTypes;
  sizes?: Sizes;
  /** How images are fit into the target dimensions. Defaults to sharp's 'cover'. */
  fit?: Fit;
  /** Max number of images processed in parallel. Defaults to 4. */
  concurrency?: number;
  s3Config?: S3ClientConfig;
  s3Bucket?: string;
};

export type Files = Buffer | Buffer[];
