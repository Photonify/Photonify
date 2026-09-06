# Photonify

[![npm version](https://img.shields.io/npm/v/photonify.svg)](https://www.npmjs.com/package/photonify)
[![npm downloads](https://img.shields.io/npm/dm/photonify.svg)](https://www.npmjs.com/package/photonify)
[![CI](https://github.com/Photonify/Photonify/actions/workflows/ci.yml/badge.svg)](https://github.com/Photonify/Photonify/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-3178C6.svg)](https://www.typescriptlang.org/)
[![node](https://img.shields.io/node/v/photonify.svg)](https://nodejs.org/)
[![license](https://img.shields.io/npm/l/photonify.svg)](./LICENSE.md)

Photonify processes image buffers into multiple resized variants in a single
call. Given one or more input buffers and a set of named sizes, it resizes each
image to every size, encodes the result to `jpg`, `png`, `tiff`, `webp`, or
`avif`, and writes
the output to the local filesystem or uploads it directly to AWS S3. Each output
is named `<uuid>-<sizeAlias>.<format>`, so filenames are unique across runs and
safe to write without overwrite checks.

Resizing is powered by [sharp](https://github.com/lovell/sharp) and runs through
a concurrency-limited worker pool over the flattened (image × size) task list.
S3 uploads stream resized buffers directly to the bucket with no temp files, and
a failed run best-effort cleans up any files it already wrote. The full API is
two functions — `processFiles` and `removeFiles` — and ships with TypeScript
declarations.

## Features

- 🖼️ Resize one or many images into any number of named sizes in a single call
- 💾 Write to the **local filesystem** or upload directly to **AWS S3**
- ☁️ Streams resized buffers straight to S3 (no temp files) with the correct `ContentType`
- 🏷️ Unique fingerprinted filenames (`<uuid>-<sizeAlias>.<format>`)
- ⚙️ Configurable output format, `fit` strategy, and parallelism
- 🧹 `removeFiles` for batch-deleting S3 objects (auto-chunked past S3's 1000-key limit)
- 🧩 First-class TypeScript types
- 🔇 No console noise — errors propagate to you

## Requirements

- **Node.js `>=20.9.0`** (required by sharp 0.35)
- sharp may need platform-specific setup in some environments — see the
  [sharp install docs](https://sharp.pixelplumbing.com/install#cross-platform)

## Installation

```bash
npm install photonify
# or
yarn add photonify
```

## Quick start

```javascript
import { processFiles } from 'photonify';
import path from 'path';

// e.g. an image buffer from a multipart upload (Multer, etc.)
const imageBuffer = req.file.buffer;

const { createdFiles } = await processFiles([imageBuffer], {
  outputDest: path.join(__dirname, 'resized_images'),
});

console.log(createdFiles);
// [
//   'a1b2...c3-xl.jpg',
//   'a1b2...c3-lg.jpg',
//   'a1b2...c3-md.jpg',
//   'a1b2...c3-sm.jpg',
// ]
```

## API

### `processFiles(files, settings)`

Resizes each input image into every configured size and stores the results.

- **`files`**: `Buffer | Buffer[]` — one or more image buffers _(required)_
- **`settings`**: `Settings` — see below
- **Returns**: `Promise<{ createdFiles: string[] }>` — the generated filenames,
  one per _(image × size)_. Filenames are `<uuid>-<sizeAlias>.<format>`.

#### `Settings`

| Option               | Type                                                                                  | Default             | Notes                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------ |
| `storage`            | `'local' \| 's3'`                                                                     | `'local'`           | Where output is written. Any other value is rejected up front.                                         |
| `outputDest`         | `string`                                                                              | —                   | **Required for local storage.** Directory to write to; created if it doesn't exist.                    |
| `outputFormat`       | `'jpg' \| 'png' \| 'tiff' \| 'webp' \| 'avif'`                                        | `'jpg'`             | Output encoding and file extension.                                                                    |
| `sizes`              | `Record<string, { width?: number; height?: number }>`                                 | 4 sizes (see below) | Map of alias → dimensions. See [Sizes](#sizes) for alias and dimension rules.                          |
| `fit`                | `'contain' \| 'cover' \| 'fill' \| 'inside' \| 'outside'`                             | `'cover'`           | How images fit the target box. See [sharp resize](https://sharp.pixelplumbing.com/api-resize).         |
| `withoutEnlargement` | `boolean`                                                                             | `false`             | When true, images smaller than a target size are left as-is instead of being upscaled to fill the box. |
| `formatOptions`      | `FormatOptions`                                                                       | —                   | Encoder options passed to sharp for the chosen `outputFormat`, e.g. `{ quality: 90 }`.                 |
| `concurrency`        | `number`                                                                              | `4`                 | Max _(image × size)_ tasks in parallel. A positive integer, or `Infinity` for no limit.                |
| `s3Config`           | [`S3ClientConfig`](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/) | —                   | **Required for S3 storage.** Passed straight to the AWS SDK `S3Client`.                                |
| `s3Bucket`           | `string`                                                                              | —                   | **Required for S3 storage.** Destination bucket.                                                       |

#### Sizes

Each entry in `sizes` maps an alias to a target box. `processFiles` validates
the map up front and rejects before doing any work if:

- the map is empty;
- an alias contains anything other than letters, digits, `_`, or `-` (the alias
  becomes part of the filename / S3 key, so `/` and `..` are not allowed);
- a size has neither `width` nor `height`;
- a `width` or `height` is not a positive integer.

Give one dimension to preserve the source aspect ratio, or both to fit the
image into the box using `fit`.

EXIF orientation is applied before resizing, so photos from phones and cameras
come out upright. The orientation tag itself is not carried into the output.

When `sizes` is omitted, these four are produced. Each sets only a width, so the
height is derived from the source aspect ratio (no cropping or stretching):

| Alias | Width | Height            |
| ----- | ----- | ----------------- |
| `xl`  | 1280  | from source ratio |
| `lg`  | 1024  | from source ratio |
| `md`  | 640   | from source ratio |
| `sm`  | 320   | from source ratio |

### `removeFiles(fileNames, settings)`

Deletes objects from S3. Requests are automatically chunked into batches of
1000 keys (the S3 `DeleteObjects` limit), and the call **throws if S3 reports
any per-key deletion errors**.

- **`fileNames`**: `string[]` — S3 object keys to delete _(required)_
- **`settings`**: `RemoveSettings` — `{ storage: 's3', s3Config, s3Bucket }` _(all required)_
- **Returns**: `Promise<void>`

> There is intentionally no local-filesystem delete support. Use Node's
> [`fs.unlink`](https://nodejs.org/api/fs.html#fspromisesunlinkpath) directly for local files.

## Usage

### Local filesystem

```javascript
import { processFiles } from 'photonify';
import path from 'path';

const { createdFiles } = await processFiles([imageBuffer], {
  outputDest: path.join(__dirname, 'resized_images'),
  outputFormat: 'png',
  sizes: {
    lg: { width: 500, height: 250 },
    md: { width: 250, height: 125 },
  },
});
```

### AWS S3

Resized images are streamed straight to S3 — no local staging — each with the
correct `ContentType` for the output format.

```javascript
import { processFiles } from 'photonify';

const { createdFiles } = await processFiles([imageBuffer], {
  storage: 's3',
  s3Config: {
    region: 'us-west-1',
    // any S3ClientConfig option is supported, e.g. credentials, endpoint, forcePathStyle
  },
  s3Bucket: 'photonify',
});
// createdFiles are the S3 object keys that were uploaded
```

### Custom sizes, formats & aspect ratio

Aliases are arbitrary, and you can constrain a single dimension to preserve the
source aspect ratio:

```javascript
await processFiles([imageBuffer], {
  outputDest: './out',
  outputFormat: 'tiff',
  fit: 'contain',
  sizes: {
    hero: { width: 1600, height: 600 }, // exact box
    thumb: { width: 200 }, // height derived from aspect ratio
    banner: { height: 400 }, // width derived from aspect ratio
  },
});
```

### Controlling parallelism

`processFiles` runs a concurrency-limited worker pool over every
_(image × size)_ pair. Tune it for large batches:

```javascript
await processFiles(manyBuffers, {
  outputDest: './out',
  concurrency: 8,
});
```

### Removing S3 files

```javascript
import { removeFiles } from 'photonify';

await removeFiles(['file1.jpg', 'file2.jpg'], {
  storage: 's3',
  s3Config: { region: 'us-west-1' },
  s3Bucket: 'photonify',
});
```

## Error handling

`processFiles` and `removeFiles` reject rather than logging. Every rejection is
a `PhotonifyError` (exported from the package), so you can branch on it with
`instanceof` instead of matching the message string. When the failure
originates elsewhere — a sharp decode error, an S3 transport error — the
original is attached as `cause`.

On a processing failure, `processFiles` stops scheduling new work, waits for
every in-flight task to finish, then best-effort removes everything the call
produced (local files are unlinked; S3 objects are deleted with
`DeleteObjects`). Cleanup failures are ignored, and the S3 rollback is
time-bounded (10s per `DeleteObjects` batch) so an S3 outage cannot add the AWS
SDK's full retry latency before the caller sees the original failure. It then
rejects with a
`Photonify: Error processing images` error whose `cause` is the underlying
error:

```javascript
import { processFiles, PhotonifyError } from 'photonify';

try {
  await processFiles([imageBuffer], { outputDest: './out' });
} catch (err) {
  if (err instanceof PhotonifyError) {
    console.error(err.message); // 'Photonify: Error processing images'
    console.error(err.cause); // the original sharp/S3 error
  }
}
```

## TypeScript

Photonify ships its own type declarations. The public functions, the
`PhotonifyError` class, and all the types are exported from the package root:

```typescript
import { processFiles, removeFiles, PhotonifyError } from 'photonify';
import type {
  Settings,
  RemoveSettings,
  Sizes,
  Size,
  Fit,
  SupportedFileTypes,
  FormatOptions,
  Files,
  ProcessResult,
} from 'photonify';
```

## Photonify uses sharp

Image processing is powered by [sharp](https://github.com/lovell/sharp). See the
[cross-platform install notes](https://sharp.pixelplumbing.com/install#cross-platform)
if you deploy to a different OS/architecture than you develop on.

## Example app

A working Express example lives at
[photonify/photonify-express-example](https://github.com/photonify/photonify-express-example),
using [Multer](https://github.com/expressjs/multer) to access multipart file data.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for release history.

## License

MIT — see [LICENSE.md](./LICENSE.md).
