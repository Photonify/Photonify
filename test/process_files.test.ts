import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

import { processFiles } from '../src/index';
import { assertRejects, cleanGeneratedFiles } from './helpers';

const IMAGES_DIR = path.join(__dirname, 'test_images');
const LOCAL_DEST = path.join(__dirname, 'tmp_resized_images');

const readImage = (name: string): Buffer =>
  fs.readFileSync(path.join(IMAGES_DIR, name));

/** A 400x200 red JPEG whose EXIF orientation says "rotate 90°" (portrait). */
const orientedImage = (): Promise<Buffer> =>
  sharp({ create: { width: 400, height: 200, channels: 3, background: 'red' } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();

const settle = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const s3Settings = {
  storage: 's3' as const,
  s3Config: { region: 'us-west-1' },
  s3Bucket: 'photonify',
};

describe('processFiles', () => {
  let s3Mock: AwsClientStub<S3Client>;

  beforeEach(() => {
    s3Mock = mockClient(S3Client);
    s3Mock.on(PutObjectCommand).resolves({});
  });

  afterEach(() => {
    s3Mock.restore();
    cleanGeneratedFiles(LOCAL_DEST);
  });

  describe('local storage', () => {
    it('accepts a single Buffer (not wrapped in an array)', async () => {
      const result = await processFiles(readImage('first_image.jpg'), {
        outputDest: LOCAL_DEST,
      });

      // one image x four default sizes
      expect(result.createdFiles).to.have.lengthOf(4);
      for (const file of result.createdFiles) {
        expect(fs.existsSync(path.join(LOCAL_DEST, file))).to.be.true;
      }
    });

    it('creates one file per image per size', async () => {
      const images = [
        readImage('first_image.jpg'),
        readImage('second_image.jpg'),
        readImage('third_image.jpg'),
      ];

      const result = await processFiles(images, {
        outputDest: LOCAL_DEST,
        sizes: {
          lg: { width: 500, height: 250 },
          md: { width: 250, height: 125 },
        },
      });

      // three images x two sizes
      expect(result.createdFiles).to.have.lengthOf(6);
    });

    it('defaults to four sizes and jpg format', async () => {
      const result = await processFiles([readImage('first_image.jpg')], {
        outputDest: LOCAL_DEST,
      });

      expect(result.createdFiles).to.have.lengthOf(4);
      for (const file of result.createdFiles) {
        expect(file).to.match(/^[a-f0-9]{32}-(xl|lg|md|sm)\.jpg$/);
      }
    });

    it('resizes images to the requested dimensions', async () => {
      const result = await processFiles([readImage('first_image.jpg')], {
        outputDest: LOCAL_DEST,
        sizes: { lg: { width: 500, height: 250 } },
      });

      const meta = await sharp(
        path.join(LOCAL_DEST, result.createdFiles[0])
      ).metadata();
      expect(meta.width).to.equal(500);
      expect(meta.height).to.equal(250);
    });

    it('preserves aspect ratio when only one dimension is given', async () => {
      const source = await sharp(readImage('first_image.jpg')).metadata();
      const result = await processFiles([readImage('first_image.jpg')], {
        outputDest: LOCAL_DEST,
        sizes: { w: { width: 300 } },
      });

      const meta = await sharp(
        path.join(LOCAL_DEST, result.createdFiles[0])
      ).metadata();
      expect(meta.width).to.equal(300);
      // height scales proportionally rather than being forced
      const expectedHeight = Math.round(
        (300 / (source.width as number)) * (source.height as number)
      );
      expect(meta.height).to.equal(expectedHeight);
    });

    it('honors a custom output format (png)', async () => {
      const result = await processFiles([readImage('first_image.jpg')], {
        outputDest: LOCAL_DEST,
        outputFormat: 'png',
        sizes: { sm: { width: 80, height: 80 } },
      });

      expect(result.createdFiles[0]).to.match(/\.png$/);
      const meta = await sharp(
        path.join(LOCAL_DEST, result.createdFiles[0])
      ).metadata();
      expect(meta.format).to.equal('png');
    });

    it('creates the output directory if it does not exist', async () => {
      const nestedDest = path.join(LOCAL_DEST, 'nested', 'dir');
      try {
        const result = await processFiles([readImage('first_image.jpg')], {
          outputDest: nestedDest,
          sizes: { sm: { width: 40, height: 40 } },
        });
        expect(fs.existsSync(path.join(nestedDest, result.createdFiles[0]))).to
          .be.true;
      } finally {
        fs.rmSync(path.join(LOCAL_DEST, 'nested'), {
          recursive: true,
          force: true,
        });
      }
    });

    it('generates unique filenames across calls', async () => {
      const opts = {
        outputDest: LOCAL_DEST,
        sizes: { sm: { width: 80, height: 80 } },
      };
      const first = await processFiles([readImage('first_image.jpg')], opts);
      const second = await processFiles([readImage('first_image.jpg')], opts);

      expect(first.createdFiles[0]).to.not.equal(second.createdFiles[0]);
    });

    it('returns an empty list when given no files', async () => {
      const result = await processFiles([], { outputDest: LOCAL_DEST });
      expect(result.createdFiles).to.deep.equal([]);
    });

    it('cleans up already-written files when a later image fails', async () => {
      const countFiles = () =>
        fs.existsSync(LOCAL_DEST) ? fs.readdirSync(LOCAL_DEST).length : 0;
      const before = countFiles();

      await assertRejects(
        processFiles(
          [readImage('first_image.jpg'), Buffer.from('not an image')],
          {
            outputDest: LOCAL_DEST,
            sizes: { sm: { width: 40, height: 40 } },
            concurrency: 1, // process the valid image first, then fail
          }
        ),
        'Error processing images'
      );

      // the file written for the first image should have been removed
      expect(countFiles()).to.equal(before);
    });

    it('waits for in-flight tasks before cleaning up when one fails early', async () => {
      const countFiles = () =>
        fs.existsSync(LOCAL_DEST) ? fs.readdirSync(LOCAL_DEST).length : 0;
      const before = countFiles();
      const good = readImage('first_image.jpg');

      // The bad buffer fails immediately on one worker while the other
      // workers are still resizing large outputs. Cleanup must not run until
      // those writes have finished, otherwise they land after the unlink.
      await assertRejects(
        processFiles([Buffer.from('not an image'), good, good, good], {
          outputDest: LOCAL_DEST,
          concurrency: 4,
          sizes: {
            a: { width: 2000, height: 2000 },
            b: { width: 1900, height: 1900 },
          },
        }),
        'Error processing images'
      );

      expect(countFiles()).to.equal(before);
      // Give any (incorrectly) still-running writes a chance to surface.
      await settle(1000);
      expect(countFiles()).to.equal(before);
    });

    it('applies EXIF orientation so output pixels are upright', async () => {
      const result = await processFiles(await orientedImage(), {
        outputDest: LOCAL_DEST,
        sizes: { t: { width: 100 } },
      });

      const meta = await sharp(
        path.join(LOCAL_DEST, result.createdFiles[0])
      ).metadata();
      // 400x200 rotated 90° is 200x400 portrait; width 100 => 100x200
      expect(meta.width).to.equal(100);
      expect(meta.height).to.equal(200);
      expect(meta.orientation).to.be.undefined;
    });

    it('exposes the underlying error as `cause`', async () => {
      const error = (await assertRejects(
        processFiles([Buffer.from('not an image')], { outputDest: LOCAL_DEST }),
        'Error processing images'
      )) as Error & { cause?: unknown };

      expect(error.cause).to.be.instanceOf(Error);
      expect((error.cause as Error).message).to.match(
        /unsupported image format/i
      );
    });
  });

  describe('validation', () => {
    it('rejects when storage is s3 but s3Config is missing', async () => {
      await assertRejects(
        processFiles([readImage('first_image.jpg')], {
          storage: 's3',
          s3Bucket: 'photonify',
        }),
        's3Config or s3Bucket is not set'
      );
    });

    it('rejects when storage is s3 but s3Bucket is missing', async () => {
      await assertRejects(
        processFiles([readImage('first_image.jpg')], {
          storage: 's3',
          s3Config: { region: 'us-west-1' },
        }),
        's3Config or s3Bucket is not set'
      );
    });

    it('rejects when local storage has no outputDest', async () => {
      await assertRejects(
        processFiles([readImage('first_image.jpg')], {}),
        'outputDest is required'
      );
    });

    it('rejects when the buffer is not a valid image', async () => {
      await assertRejects(
        processFiles([Buffer.from('this is not an image')], {
          outputDest: LOCAL_DEST,
        }),
        'Error processing images'
      );
    });

    it('rejects an unsupported output format', async () => {
      await assertRejects(
        processFiles([readImage('first_image.jpg')], {
          outputDest: LOCAL_DEST,
          outputFormat: 'gif' as unknown as 'jpg',
          sizes: { sm: { width: 40, height: 40 } },
        }),
        'Unsupported output format'
      );
    });

    it('rejects a size alias that could escape the output directory', async () => {
      for (const alias of ['../../escaped', 'a/b', 'a\\b', 'with space', '']) {
        await assertRejects(
          processFiles([readImage('first_image.jpg')], {
            outputDest: LOCAL_DEST,
            sizes: { [alias]: { width: 10 } },
          }),
          'Invalid size alias'
        );
      }
    });

    it('accepts aliases made of letters, digits, "_" and "-"', async () => {
      const result = await processFiles([readImage('first_image.jpg')], {
        outputDest: LOCAL_DEST,
        sizes: { 'Thumb_2x-v1': { width: 10 } },
      });
      expect(result.createdFiles[0]).to.match(/-Thumb_2x-v1\.jpg$/);
    });

    it('rejects a size with neither width nor height', async () => {
      await assertRejects(
        processFiles([readImage('first_image.jpg')], {
          outputDest: LOCAL_DEST,
          sizes: { t: {} },
        }),
        'must specify a width, a height, or both'
      );
    });

    it('rejects a size with a non-positive-integer dimension', async () => {
      for (const width of [0, -5, 1.5, NaN]) {
        await assertRejects(
          processFiles([readImage('first_image.jpg')], {
            outputDest: LOCAL_DEST,
            sizes: { t: { width } },
          }),
          'invalid width'
        );
      }
    });

    it('rejects a concurrency that is not a positive integer', async () => {
      for (const concurrency of [NaN, 0, -1, 1.5]) {
        await assertRejects(
          processFiles([readImage('first_image.jpg')], {
            outputDest: LOCAL_DEST,
            sizes: { t: { width: 10 } },
            concurrency,
          }),
          'concurrency must be a positive integer'
        );
      }
    });
  });

  describe('s3 storage', () => {
    it('uploads one object per image per size and writes nothing locally', async () => {
      const result = await processFiles([readImage('first_image.jpg')], {
        ...s3Settings,
        sizes: {
          sm: { width: 80, height: 80 },
          md: { width: 160, height: 160 },
        },
      });

      expect(result.createdFiles).to.have.lengthOf(2);
      expect(s3Mock.commandCalls(PutObjectCommand)).to.have.lengthOf(2);
      for (const file of result.createdFiles) {
        expect(fs.existsSync(path.join(LOCAL_DEST, file))).to.be.false;
      }
    });

    it('uploads to the configured bucket with the correct key and content type', async () => {
      await processFiles([readImage('first_image.jpg')], {
        ...s3Settings,
        s3Bucket: 'my-bucket',
        outputFormat: 'png',
        sizes: { sm: { width: 80, height: 80 } },
      });

      const input = s3Mock.commandCalls(PutObjectCommand)[0].args[0].input;
      expect(input.Bucket).to.equal('my-bucket');
      expect(input.Key).to.match(/^[a-f0-9]{32}-sm\.png$/);
      expect(input.ContentType).to.equal('image/png');
      expect(input.Body).to.be.instanceOf(Buffer);
    });

    it('surfaces upload failures', async () => {
      s3Mock.on(PutObjectCommand).rejects(new Error('access denied'));
      await assertRejects(
        processFiles([readImage('first_image.jpg')], {
          ...s3Settings,
          sizes: { sm: { width: 80, height: 80 } },
        }),
        'Error processing images'
      );
    });

    it('waits for in-flight uploads, then best-effort deletes them on failure', async () => {
      let started = 0;
      let finished = 0;
      s3Mock.on(PutObjectCommand).callsFake(async () => {
        started += 1;
        await settle(150);
        finished += 1;
        return {};
      });

      const good = readImage('first_image.jpg');
      await assertRejects(
        processFiles([good, good, Buffer.from('not an image')], {
          ...s3Settings,
          concurrency: 3,
          sizes: { sm: { width: 20, height: 20 } },
        }),
        'Error processing images'
      );

      // Every upload that started had completed before the rejection.
      expect(started).to.be.greaterThan(0);
      expect(finished).to.equal(started);

      const deletes = s3Mock.commandCalls(DeleteObjectsCommand);
      expect(deletes).to.have.lengthOf(1);
      const input = deletes[0].args[0].input;
      expect(input.Bucket).to.equal(s3Settings.s3Bucket);
      expect(input.Delete?.Quiet).to.be.true;
      const uploadedKeys = s3Mock
        .commandCalls(PutObjectCommand)
        .map(call => call.args[0].input.Key);
      expect(input.Delete?.Objects?.map(o => o.Key)).to.have.members(
        uploadedKeys
      );
    });

    it('still rejects with the original cause when rollback deletes fail', async () => {
      s3Mock.on(DeleteObjectsCommand).rejects(new Error('delete denied'));
      const good = readImage('first_image.jpg');

      const error = (await assertRejects(
        processFiles([good, Buffer.from('not an image')], {
          ...s3Settings,
          concurrency: 1,
          sizes: { sm: { width: 20, height: 20 } },
        }),
        'Error processing images'
      )) as Error & { cause?: unknown };

      expect((error.cause as Error).message).to.match(
        /unsupported image format/i
      );
      expect(s3Mock.commandCalls(DeleteObjectsCommand)).to.have.lengthOf(1);
    });

    it('destroys the S3 client on success and on failure', async () => {
      let destroyCount = 0;
      const original = S3Client.prototype.destroy;
      S3Client.prototype.destroy = function destroy(this: S3Client) {
        destroyCount += 1;
        return original.apply(this);
      };

      try {
        await processFiles([readImage('first_image.jpg')], {
          ...s3Settings,
          sizes: { sm: { width: 20, height: 20 } },
        });
        expect(destroyCount).to.equal(1);

        await assertRejects(
          processFiles([Buffer.from('not an image')], {
            ...s3Settings,
            sizes: { sm: { width: 20, height: 20 } },
          }),
          'Error processing images'
        );
        expect(destroyCount).to.equal(2);
      } finally {
        S3Client.prototype.destroy = original;
      }
    });
  });
});
