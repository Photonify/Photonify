# Photonify

Photonify is a utility to manage image uploads and automatically process them into fingerprinted files. The plugin also supports S3 uploads.

## Installation

#### NPM

```bash
npm install photonify
```

#### Yarn

```bash
yarn add photonify
```

## Usage

- Photonify has a method called `processFiles` that will create four resized photos for you by default. The arguments passed to this method will differ slightly depending on filesystem vs. S3 storage.
- `processFiles` resolves to `{ createdFiles: string[] }` — the generated filenames (`<uuid>-<sizeAlias>.<format>`).
- Both examples are below:

#### Filesystem Storage:

Parameters (second argument, `Settings`):

- `files`: _Buffer | Buffer[] - Required (first argument)_
- `outputDest`: _string - Required_ — directory to write to (created if missing)
- `outputFormat`: _'jpg' | 'png' | 'tiff'_ — defaults to `'jpg'`
- `sizes`: _Record<string, { width?: number; height?: number }>_ — alias → dimensions; defaults to `xl`/`lg`/`md`/`sm`. Provide `width`, `height`, or both (a single dimension preserves aspect ratio)
- `fit`: _'contain' | 'cover' | 'fill' | 'inside' | 'outside'_ — how images fit the target box; defaults to sharp's `'cover'`
- `concurrency`: _number_ — max images processed in parallel; defaults to `4`

Example with Custom Sizes:

```javascript
import { processFiles } from 'photonify';

const imageBuffer = req.file.buffer;

const result = await processFiles([imageBuffer], {
  outputDest: path.join(__dirname, 'resized_images'),
  sizes: {
    lg: {
      width: 500,
      height: 250,
    },
    md: {
      width: 250,
      height: 125,
    },
  },
});
```

#### S3 Storage:

With `storage: 's3'`, resized images are streamed straight to S3 (no local
staging) with the correct `ContentType` for the output format.

Parameters (second argument, `Settings`):

- `files`: _Buffer | Buffer[] - Required (first argument)_
- `storage`: _'s3' - Required_
- `s3Config`: _[S3ClientConfig](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/) - Required_
- `s3Bucket`: _string - Required_
- `outputFormat`, `sizes`, `fit`, `concurrency`: _same as above_

Example:

```javascript
import { processFiles } from 'photonify';

const imageBuffer = req.file.buffer;

const result = await processFiles([imageBuffer], {
  storage: 's3',
  s3Config: {
    region: 'us-west-1',
  },
  s3Bucket: 'photonify',
});
```

## Photonify Uses Sharp

- Under the hood, Photonify uses Sharp to process images: https://github.com/lovell/sharp
- Sharp may require additional setup steps for your specific environment. See [this documentation](https://sharp.pixelplumbing.com/install#cross-platform) for more details.

## Removing Files

- Photonify has support for removing files from S3
- Note: No support for local filesystem removal is added to Photonify. You are encouraged to use the built-in [fs.unlink](https://nodejs.org/api/fs.html#fspromisesunlinkpath) method instead.

#### Removing S3 Files:

- `removeFiles` batches deletes automatically (S3 allows up to 1000 keys per request) and throws if S3 reports any per-key failures.

Parameters:

- `fileNames`: _string[] - Required_
- `storage`: _'s3' - Required_
- `s3Config`: _[S3ClientConfig](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/) - Required_
- `s3Bucket`: _string - Required_

Example:

```javascript
import { removeFiles } from 'photonify';

await removeFiles(['file1.jpg', 'file2.jpg'], {
  storage: 's3',
  s3Config: {
    region: 'us-west-1',
  },
  s3Bucket: 'photonify',
});
```

## Example App

- You can see a working example application that uses Express JS [here](https://github.com/photonify/photonify-express-example).
- This example uses the [Multer](https://github.com/expressjs/multer) plugin to access multipart file data.
