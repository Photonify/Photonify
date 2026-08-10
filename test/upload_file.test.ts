import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

import { uploadFile } from '../src/upload_file';
import { Settings } from '../src/types';
import { assertRejects } from './helpers';

const validSettings: Settings = {
  storage: 's3',
  s3Config: { region: 'us-west-1' },
  s3Bucket: 'photonify',
};

const makeTempFile = (contents: string): string => {
  const filePath = path.join(
    os.tmpdir(),
    `photonify-upload-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`
  );
  fs.writeFileSync(filePath, contents);
  return filePath;
};

describe('uploadFile', () => {
  let s3Mock: AwsClientStub<S3Client>;

  beforeEach(() => {
    s3Mock = mockClient(S3Client);
    s3Mock.on(PutObjectCommand).resolves({});
  });

  afterEach(() => {
    s3Mock.restore();
  });

  describe('validation', () => {
    it('rejects when s3Config is missing', async () => {
      await assertRejects(
        uploadFile({ s3Bucket: 'photonify' }, '/tmp/x', 'x'),
        'S3 configuration is missing'
      );
    });

    it('rejects when s3Bucket is missing', async () => {
      await assertRejects(
        uploadFile({ s3Config: { region: 'us-west-1' } }, '/tmp/x', 'x'),
        'S3 configuration is missing'
      );
    });

    it('rejects when the file path is missing', async () => {
      await assertRejects(
        uploadFile(validSettings, '', 'x.jpg'),
        'File path or filename is missing'
      );
    });

    it('rejects when the file name is missing', async () => {
      await assertRejects(
        uploadFile(validSettings, '/tmp/x.jpg', ''),
        'File path or filename is missing'
      );
    });
  });

  describe('upload', () => {
    it('sends a PutObject with the correct bucket, key, and body', async () => {
      const filePath = makeTempFile('hello world');

      await uploadFile(validSettings, filePath, 'photo-sm.jpg');

      const calls = s3Mock.commandCalls(PutObjectCommand);
      expect(calls).to.have.lengthOf(1);
      const input = calls[0].args[0].input;
      expect(input.Bucket).to.equal('photonify');
      expect(input.Key).to.equal('photo-sm.jpg');
      expect((input.Body as Buffer).toString()).to.equal('hello world');
    });

    it('deletes the temp file after a successful upload', async () => {
      const filePath = makeTempFile('payload');

      await uploadFile(validSettings, filePath, 'photo-sm.jpg');

      expect(fs.existsSync(filePath)).to.be.false;
    });

    it('propagates S3 errors and leaves the temp file in place', async () => {
      s3Mock.on(PutObjectCommand).rejects(new Error('network down'));
      const filePath = makeTempFile('payload');

      try {
        await assertRejects(
          uploadFile(validSettings, filePath, 'photo-sm.jpg'),
          'network down'
        );
        expect(fs.existsSync(filePath)).to.be.true;
      } finally {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    });
  });
});
