import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

import { processFiles } from '../src/index';
import { assertRejects, cleanGeneratedFiles } from './helpers';

const IMAGES_DIR = path.join(__dirname, 'test_images');
const LOCAL_DEST = path.join(__dirname, 'tmp_resized_images');

const readImage = (name: string): Buffer =>
  fs.readFileSync(path.join(IMAGES_DIR, name));

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
  });
});
