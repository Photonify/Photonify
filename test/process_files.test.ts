import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
  mockClient,
  AwsClientStub,
} from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

import { processFiles } from '../src/index';
import { assertRejects, cleanGeneratedFiles } from './helpers';

const IMAGES_DIR = path.join(__dirname, 'test_images');
const LOCAL_DEST = path.join(__dirname, 'tmp_resized_images');
const S3_STAGING = path.join(__dirname, '../tmp_for_upload');

const readImage = (name: string): Buffer =>
  fs.readFileSync(path.join(IMAGES_DIR, name));

describe('processFiles', () => {
  let s3Mock: AwsClientStub<S3Client>;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    s3Mock = mockClient(S3Client);
    s3Mock.on(PutObjectCommand).resolves({});
  });

  afterEach(() => {
    s3Mock.restore();
    process.env.NODE_ENV = originalNodeEnv;
    cleanGeneratedFiles(LOCAL_DEST);
    cleanGeneratedFiles(S3_STAGING);
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

    it('rejects when the buffer is not a valid image', async () => {
      await assertRejects(
        processFiles([Buffer.from('this is not an image')], {
          outputDest: LOCAL_DEST,
        }),
        'Error processing images'
      );
    });
  });

  describe('s3 storage', () => {
    it('stages files locally and skips upload when NODE_ENV=test', async () => {
      process.env.NODE_ENV = 'test';

      const result = await processFiles([readImage('first_image.jpg')], {
        storage: 's3',
        s3Config: { region: 'us-west-1' },
        s3Bucket: 'photonify',
      });

      for (const file of result.createdFiles) {
        expect(fs.existsSync(path.join(S3_STAGING, file))).to.be.true;
      }
      expect(s3Mock.commandCalls(PutObjectCommand)).to.have.lengthOf(0);
    });

    it('uploads to S3 and removes staging files when not in test env', async () => {
      process.env.NODE_ENV = 'production';

      const result = await processFiles([readImage('first_image.jpg')], {
        storage: 's3',
        s3Config: { region: 'us-west-1' },
        s3Bucket: 'photonify',
        sizes: { sm: { width: 80, height: 80 }, md: { width: 160, height: 160 } },
      });

      // one image x two sizes = two uploads
      expect(s3Mock.commandCalls(PutObjectCommand)).to.have.lengthOf(2);
      // staging files are cleaned up after a successful upload
      for (const file of result.createdFiles) {
        expect(fs.existsSync(path.join(S3_STAGING, file))).to.be.false;
      }
    });

    it('uploads each file to the configured bucket', async () => {
      process.env.NODE_ENV = 'production';

      await processFiles([readImage('first_image.jpg')], {
        storage: 's3',
        s3Config: { region: 'us-west-1' },
        s3Bucket: 'my-bucket',
        sizes: { sm: { width: 80, height: 80 } },
      });

      const call = s3Mock.commandCalls(PutObjectCommand)[0];
      expect(call.args[0].input.Bucket).to.equal('my-bucket');
      expect(call.args[0].input.Key).to.match(/^[a-f0-9]{32}-sm\.jpg$/);
    });
  });
});
