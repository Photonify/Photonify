import { expect } from 'chai';
import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

import { uploadFile } from '../src/upload_file';
import { assertRejects } from './helpers';

describe('uploadFile', () => {
  let s3Mock: AwsClientStub<S3Client>;
  let client: S3Client;

  beforeEach(() => {
    s3Mock = mockClient(S3Client);
    s3Mock.on(PutObjectCommand).resolves({});
    client = new S3Client({ region: 'us-west-1' });
  });

  afterEach(() => {
    s3Mock.restore();
  });

  describe('validation', () => {
    it('rejects when the bucket is missing', async () => {
      await assertRejects(
        uploadFile(client, '', 'key.jpg', Buffer.from('x')),
        'S3 bucket is missing'
      );
    });

    it('rejects when the key is missing', async () => {
      await assertRejects(
        uploadFile(client, 'bucket', '', Buffer.from('x')),
        'File body or key is missing'
      );
    });

    it('rejects when the body is missing', async () => {
      await assertRejects(
        uploadFile(client, 'bucket', 'key.jpg', undefined as unknown as Buffer),
        'File body or key is missing'
      );
    });
  });

  describe('upload', () => {
    it('sends a PutObject with bucket, key, body, and content type', async () => {
      const body = Buffer.from('image-bytes');

      await uploadFile(client, 'photonify', 'photo-sm.jpg', body, 'image/jpeg');

      const calls = s3Mock.commandCalls(PutObjectCommand);
      expect(calls).to.have.lengthOf(1);
      const input = calls[0].args[0].input;
      expect(input.Bucket).to.equal('photonify');
      expect(input.Key).to.equal('photo-sm.jpg');
      expect(input.ContentType).to.equal('image/jpeg');
      expect((input.Body as Buffer).equals(body)).to.be.true;
    });

    it('propagates S3 errors', async () => {
      s3Mock.on(PutObjectCommand).rejects(new Error('network down'));

      await assertRejects(
        uploadFile(client, 'photonify', 'photo-sm.jpg', Buffer.from('x')),
        'network down'
      );
    });
  });
});
