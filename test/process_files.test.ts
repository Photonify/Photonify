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

import { processFiles, PhotonifyError } from '../src/index';
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
      const expectedHeight = Math.round((300 / source.width) * source.height);
      expect(meta.height).to.equal(expectedHeight);
    });

    it('applies the fit strategy when both dimensions are given', async () => {
      // A 100x50 (2:1) source into a 40x40 box.
      const wide = await sharp({
        create: { width: 100, height: 50, channels: 3, background: 'red' },
      })
        .jpeg()
        .toBuffer();

      const inside = await processFiles(wide, {
        outputDest: LOCAL_DEST,
        fit: 'inside',
        sizes: { box: { width: 40, height: 40 } },
      });
      const insideMeta = await sharp(
        path.join(LOCAL_DEST, inside.createdFiles[0])
      ).metadata();
      // 'inside' scales to fit within the box, preserving aspect ratio.
      expect(insideMeta.width).to.equal(40);
      expect(insideMeta.height).to.equal(20);

      const cover = await processFiles(wide, {
        outputDest: LOCAL_DEST,
        fit: 'cover',
        sizes: { box: { width: 40, height: 40 } },
      });
      const coverMeta = await sharp(
        path.join(LOCAL_DEST, cover.createdFiles[0])
      ).metadata();
      // 'cover' fills the exact box (cropping the overflow).
      expect(coverMeta.width).to.equal(40);
      expect(coverMeta.height).to.equal(40);
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

    for (const format of ['tiff', 'webp', 'avif'] as const) {
      it(`honors a custom output format (${format})`, async () => {
        const result = await processFiles([readImage('first_image.jpg')], {
          outputDest: LOCAL_DEST,
          outputFormat: format,
          sizes: { sm: { width: 40, height: 40 } },
        });

        expect(result.createdFiles[0]).to.match(new RegExp(`\\.${format}$`));
        const meta = await sharp(
          path.join(LOCAL_DEST, result.createdFiles[0])
        ).metadata();
        // sharp reports heif for avif-encoded output
        expect(meta.format).to.equal(format === 'avif' ? 'heif' : format);
      });
    }

    it('does not upscale small images when withoutEnlargement is set', async () => {
      const small = await sharp({
        create: { width: 50, height: 50, channels: 3, background: 'blue' },
      })
        .jpeg()
        .toBuffer();

      const result = await processFiles(small, {
        outputDest: LOCAL_DEST,
        withoutEnlargement: true,
        sizes: { big: { width: 200 } },
      });

      const meta = await sharp(
        path.join(LOCAL_DEST, result.createdFiles[0])
      ).metadata();
      // Requested width 200 but the source is only 50 wide, so it stays 50.
      expect(meta.width).to.equal(50);
    });

    it('passes formatOptions through to the encoder (jpeg quality)', async () => {
      const opts = {
        outputDest: LOCAL_DEST,
        outputFormat: 'jpg' as const,
        sizes: { q: { width: 300, height: 300 } },
      };
      const low = await processFiles([readImage('first_image.jpg')], {
        ...opts,
        formatOptions: { quality: 20 },
      });
      const high = await processFiles([readImage('first_image.jpg')], {
        ...opts,
        formatOptions: { quality: 95 },
      });

      const lowSize = fs.statSync(
        path.join(LOCAL_DEST, low.createdFiles[0])
      ).size;
      const highSize = fs.statSync(
        path.join(LOCAL_DEST, high.createdFiles[0])
      ).size;
      expect(lowSize).to.be.lessThan(highSize);
    });

    it('re-encodes to outputFormat even when formatOptions sets force: false', async () => {
      // A JPEG input with force: false would otherwise stay JPEG while the
      // filename and (for S3) ContentType claim png. We force re-encoding.
      const result = await processFiles([readImage('first_image.jpg')], {
        outputDest: LOCAL_DEST,
        outputFormat: 'png',
        formatOptions: { force: false },
        sizes: { sm: { width: 40, height: 40 } },
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

    it('rejects an unknown storage value', async () => {
      await assertRejects(
        processFiles([readImage('first_image.jpg')], {
          storage: 'gcs' as unknown as 's3',
          outputDest: LOCAL_DEST,
        }),
        'Unknown storage'
      );
    });

    it('rejects a non-Buffer entry in files', async () => {
      await assertRejects(
        processFiles(['not a buffer' as unknown as Buffer], {
          outputDest: LOCAL_DEST,
        }),
        'files[0] is not a Buffer'
      );
    });

    it('throws a PhotonifyError for validation and processing failures', async () => {
      const validationError = await assertRejects(
        processFiles([readImage('first_image.jpg')], {})
      );
      expect(validationError).to.be.instanceOf(PhotonifyError);

      const processingError = await assertRejects(
        processFiles([Buffer.from('not an image')], { outputDest: LOCAL_DEST })
      );
      expect(processingError).to.be.instanceOf(PhotonifyError);
    });

    it('wraps a mkdir failure as a PhotonifyError with the OS error as cause', async () => {
      fs.mkdirSync(LOCAL_DEST, { recursive: true });
      const filePath = path.join(LOCAL_DEST, 'not-a-directory');
      fs.writeFileSync(filePath, 'x');
      try {
        // outputDest is under an existing *file*, so mkdir -p throws ENOTDIR.
        const error = await assertRejects(
          processFiles([readImage('first_image.jpg')], {
            outputDest: path.join(filePath, 'sub'),
            sizes: { sm: { width: 40, height: 40 } },
          }),
          'Could not create outputDest'
        );
        expect(error).to.be.instanceOf(PhotonifyError);
        expect((error as Error & { cause?: unknown }).cause).to.be.instanceOf(
          Error
        );
      } finally {
        fs.rmSync(filePath, { force: true });
      }
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

    it('rejects an empty sizes map', async () => {
      await assertRejects(
        processFiles([readImage('first_image.jpg')], {
          outputDest: LOCAL_DEST,
          sizes: {},
        }),
        'sizes must contain at least one entry'
      );
    });

    it('accepts concurrency: Infinity as "no limit"', async () => {
      const result = await processFiles([readImage('first_image.jpg')], {
        outputDest: LOCAL_DEST,
        sizes: { a: { width: 10 }, b: { width: 12 } },
        concurrency: Infinity,
      });
      expect(result.createdFiles).to.have.lengthOf(2);
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

    it('sends the correct content type for webp output', async () => {
      await processFiles([readImage('first_image.jpg')], {
        ...s3Settings,
        outputFormat: 'webp',
        sizes: { sm: { width: 80, height: 80 } },
      });

      const input = s3Mock.commandCalls(PutObjectCommand)[0].args[0].input;
      expect(input.Key).to.match(/\.webp$/);
      expect(input.ContentType).to.equal('image/webp');
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
      // The rollback delete is time-bounded via an abort signal. (The mock
      // types call args as a 1-tuple, so reach the options arg via a cast.)
      const sendOptions = (deletes[0].args as unknown[])[1] as
        { abortSignal?: unknown } | undefined;
      expect(sendOptions?.abortSignal).to.be.instanceOf(AbortSignal);
      const uploadedKeys = s3Mock
        .commandCalls(PutObjectCommand)
        .map(call => call.args[0].input.Key);
      expect(input.Delete?.Objects?.map(o => o.Key)).to.have.members(
        uploadedKeys
      );
    });

    it('rolls back the key whose upload threw, not only the ones that succeeded', async () => {
      // Simulates a PutObject whose response was lost after S3 stored the
      // body: the SDK rejects, but the object may exist and must be deleted.
      let calls = 0;
      s3Mock.on(PutObjectCommand).callsFake(async () => {
        calls += 1;
        if (calls === 2) throw new Error('socket hang up');
        return {};
      });

      await assertRejects(
        processFiles([readImage('first_image.jpg')], {
          ...s3Settings,
          concurrency: 1,
          sizes: { a: { width: 20 }, b: { width: 22 } },
        }),
        'Error processing images'
      );

      const attemptedKeys = s3Mock
        .commandCalls(PutObjectCommand)
        .map(call => call.args[0].input.Key);
      expect(attemptedKeys).to.have.lengthOf(2);
      const deletes = s3Mock.commandCalls(DeleteObjectsCommand);
      expect(deletes).to.have.lengthOf(1);
      expect(
        deletes[0].args[0].input.Delete?.Objects?.map(o => o.Key)
      ).to.have.members(attemptedKeys);
    });

    it('never has more than `concurrency` tasks in flight', async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      s3Mock.on(PutObjectCommand).callsFake(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await settle(50);
        inFlight -= 1;
        return {};
      });

      const good = readImage('first_image.jpg');
      await processFiles([good, good, good], {
        ...s3Settings,
        concurrency: 2,
        sizes: { a: { width: 20 }, b: { width: 22 } },
      });

      expect(s3Mock.commandCalls(PutObjectCommand)).to.have.lengthOf(6);
      expect(maxInFlight).to.equal(2);
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

    it('chunks the rollback into 1000-key DeleteObjects batches', async function () {
      // Force > 1000 uploaded keys so the rollback loop runs more than once.
      // Each key is pushed before its upload awaits, so with unlimited
      // concurrency all keys are recorded before the single failure aborts.
      this.timeout(30000);
      s3Mock.on(DeleteObjectsCommand).resolves({});

      let putCount = 0;
      s3Mock.on(PutObjectCommand).callsFake(async () => {
        putCount += 1;
        // Fail exactly one upload once all keys have been recorded.
        if (putCount === 750) throw new Error('socket hang up');
        return {};
      });

      const sizes: Record<string, { width: number }> = {};
      for (let i = 0; i < 1001; i += 1) sizes[`s${i}`] = { width: 8 };

      const tiny = await sharp({
        create: { width: 16, height: 16, channels: 3, background: 'green' },
      })
        .jpeg()
        .toBuffer();

      await assertRejects(
        processFiles(tiny, { ...s3Settings, concurrency: Infinity, sizes }),
        'Error processing images'
      );

      const deletes = s3Mock.commandCalls(DeleteObjectsCommand);
      expect(deletes).to.have.lengthOf(2); // 1000 + 1
      expect(deletes[0].args[0].input.Delete?.Objects).to.have.lengthOf(1000);
      expect(deletes[1].args[0].input.Delete?.Objects).to.have.lengthOf(1);
      // Each batch carries its own abort signal.
      for (const call of deletes) {
        const opts = (call.args as unknown[])[1] as
          { abortSignal?: unknown } | undefined;
        expect(opts?.abortSignal).to.be.instanceOf(AbortSignal);
      }
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
