import { expect } from 'chai';
import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';
import { S3Client, DeleteObjectsCommand } from '@aws-sdk/client-s3';

import { removeFiles } from '../src/index';
import { Settings } from '../src/types';
import { assertRejects } from './helpers';

const validSettings: Partial<Settings> = {
  storage: 's3',
  s3Config: { region: 'us-west-1' },
  s3Bucket: 'photonify',
};

describe('removeFiles', () => {
  let s3Mock: AwsClientStub<S3Client>;

  beforeEach(() => {
    s3Mock = mockClient(S3Client);
    s3Mock.on(DeleteObjectsCommand).resolves({});
  });

  afterEach(() => {
    s3Mock.restore();
  });

  describe('validation', () => {
    it('returns without error and issues no request when the list is empty', async () => {
      await removeFiles([], validSettings);
      expect(s3Mock.commandCalls(DeleteObjectsCommand)).to.have.lengthOf(0);
    });

    it('rejects when storage is not s3', async () => {
      await assertRejects(
        removeFiles(['a.jpg'], { ...validSettings, storage: 'local' }),
        'Storage must be set to S3'
      );
    });

    it('rejects when s3Config is missing', async () => {
      await assertRejects(
        removeFiles(['a.jpg'], { storage: 's3', s3Bucket: 'photonify' }),
        'Storage must be set to S3'
      );
    });

    it('rejects when s3Bucket is missing', async () => {
      await assertRejects(
        removeFiles(['a.jpg'], {
          storage: 's3',
          s3Config: { region: 'us-west-1' },
        }),
        'Storage must be set to S3'
      );
    });
  });

  describe('s3 delete', () => {
    it('sends a DeleteObjects request with the correct bucket and keys', async () => {
      await removeFiles(['a.jpg', 'b.jpg', 'c.jpg'], validSettings);

      const calls = s3Mock.commandCalls(DeleteObjectsCommand);
      expect(calls).to.have.lengthOf(1);
      const input = calls[0].args[0].input;
      expect(input.Bucket).to.equal('photonify');
      expect(input.Delete?.Objects).to.deep.equal([
        { Key: 'a.jpg' },
        { Key: 'b.jpg' },
        { Key: 'c.jpg' },
      ]);
    });

    it('batches deletes into chunks of 1000 keys', async () => {
      const keys = Array.from({ length: 2500 }, (_, i) => `file-${i}.jpg`);

      await removeFiles(keys, validSettings);

      const calls = s3Mock.commandCalls(DeleteObjectsCommand);
      expect(calls).to.have.lengthOf(3); // 1000 + 1000 + 500
      expect(calls[0].args[0].input.Delete?.Objects).to.have.lengthOf(1000);
      expect(calls[2].args[0].input.Delete?.Objects).to.have.lengthOf(500);
    });

    it('throws when the response reports per-key errors', async () => {
      s3Mock.on(DeleteObjectsCommand).resolves({
        Errors: [{ Key: 'a.jpg', Message: 'AccessDenied' }],
      });

      await assertRejects(
        removeFiles(['a.jpg'], validSettings),
        'S3 delete failed for - a.jpg (AccessDenied)'
      );
    });

    it('wraps and rethrows transport errors', async () => {
      s3Mock.on(DeleteObjectsCommand).rejects(new Error('access denied'));
      await assertRejects(
        removeFiles(['a.jpg'], validSettings),
        'S3 delete error - access denied'
      );
    });

    it('destroys the S3 client after completing', async () => {
      let destroyCount = 0;
      const original = S3Client.prototype.destroy;
      S3Client.prototype.destroy = function destroy(this: S3Client) {
        destroyCount += 1;
        return original.apply(this);
      };

      try {
        await removeFiles(['a.jpg'], validSettings);
        expect(destroyCount).to.equal(1);
      } finally {
        S3Client.prototype.destroy = original;
      }
    });
  });
});
