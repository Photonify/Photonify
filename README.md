# Photonify

[![CI](https://github.com/Photonify/Photonify/actions/workflows/ci.yml/badge.svg)](https://github.com/Photonify/Photonify/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/photonify.svg)](https://www.npmjs.com/package/photonify)
[![npm downloads](https://img.shields.io/npm/dm/photonify.svg)](https://www.npmjs.com/package/photonify)
[![license](https://img.shields.io/npm/l/photonify.svg)](./LICENSE.md)

Photonify takes image buffers, resizes them into multiple sizes with
[sharp](https://github.com/lovell/sharp), and stores the results on the local
filesystem or in AWS S3. Each output file is given a unique, fingerprinted name.

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

| Option         | Type                                                                                  | Default         | Notes                                                                                          |
| -------------- | ------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------- |
| `storage`      | `'local' \| 's3'`                                                                     | `'local'`       | Where output is written.                                                                       |
| `outputDest`   | `string`                                                                              | —               | **Required for local storage.** Directory to write to; created if it doesn't exist.            |
| `outputFormat` | `'jpg' \| 'png' \| 'tiff'`                                                            | `'jpg'`         | Output encoding and file extension.                                                            |
| `sizes`        | `Record<string, { width?: number; height?: number }>`                                 | `DEFAULT_SIZES` | Map of alias → dimensions. Aliases are arbitrary. One dimension preserves aspect ratio.        |
| `fit`          | `'contain' \| 'cover' \| 'fill' \| 'inside' \| 'outside'`                             | `'cover'`       | How images fit the target box. See [sharp resize](https://sharp.pixelplumbing.com/api-resize). |
| `concurrency`  | `number`                                                                              | `4`             | Max images processed in parallel.                                                              |
| `s3Config`     | [`S3ClientConfig`](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/) | —               | **Required for S3 storage.** Passed straight to the AWS SDK `S3Client`.                        |
| `s3Bucket`     | `string`                                                                              | —               | **Required for S3 storage.** Destination bucket.                                               |

#### Default sizes

When `sizes` is omitted, these four are produced:

| Alias | Width | Height |
| ----- | ----- | ------ |
| `xl`  | 1280  | 801    |
| `lg`  | 1024  | 768    |
| `md`  | 640   | 480    |
| `sm`  | 160   | 144    |

### `removeFiles(fileNames, settings)`

Deletes objects from S3. Requests are automatically chunked into batches of
1000 keys (the S3 `DeleteObjects` limit), and the call **throws if S3 reports
any per-key deletion errors**.

- **`fileNames`**: `string[]` — S3 object keys to delete _(required)_
- **`settings`**: `{ storage: 's3', s3Config, s3Bucket }` _(all required)_
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

`processFiles` and `removeFiles` reject rather than logging. On a processing
failure, `processFiles` cleans up any files it already wrote locally and rejects
with a `Photonify: Error processing images` error whose `cause` is the
underlying error:

```javascript
try {
  await processFiles([imageBuffer], { outputDest: './out' });
} catch (err) {
  console.error(err.message); // 'Photonify: Error processing images'
  console.error(err.cause); // the original sharp/S3 error
}
```

## TypeScript

Photonify ships its own type declarations. The main types are exported for reuse:

```typescript
import { processFiles } from 'photonify';
import type {
  Settings,
  Sizes,
  Fit,
  SupportedFileTypes,
} from 'photonify/dist/src/types';
```

## Photonify uses sharp

Image processing is powered by [sharp](https://github.com/lovell/sharp). See the
[cross-platform install notes](https://sharp.pixelplumbing.com/install#cross-platform)
if you deploy to a different OS/architecture than you develop on.

## Example app

A working Express example lives at
[photonify/photonify-express-example](https://github.com/photonify/photonify-express-example),
using [Multer](https://github.com/expressjs/multer) to access multipart file data.

## Migrating from 3.x to 4.x

4.0.0 contains breaking changes:

- **`NODE_ENV=test` no longer skips S3 uploads/deletes.** Previously the library
  silently no-op'd S3 calls under `NODE_ENV=test`, which broke consumers running
  their app with that env. Mock the S3 client in your tests instead.
- **`s3Config` is now the AWS SDK's `S3ClientConfig`** (a widening of the old
  `{ region, credentials }` shape) — existing configs keep working and now
  accept `endpoint`, `forcePathStyle`, etc.
- **Node `>=20.9.0` is required.**
- S3 uploads now go directly to the bucket (no `tmp_for_upload` staging dir) and
  set `ContentType` automatically.

See the [v4.0.0 release notes](https://github.com/Photonify/Photonify/releases/tag/v4.0.0)
for the full list.

## License

ISC — see [LICENSE.md](./LICENSE.md).
