import { expect } from 'chai';
import fs from 'fs';
import path from 'path';

/**
 * Await a promise that is expected to reject and return the resulting error.
 * Optionally assert that the error message contains `messageIncludes`.
 * Fails the test if the promise resolves instead of rejecting.
 */
export async function assertRejects(
  promise: Promise<unknown>,
  messageIncludes?: string
): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    const error = err as Error;
    if (messageIncludes) {
      expect(error.message).to.include(messageIncludes);
    }
    return error;
  }
  throw new Error('Expected promise to reject, but it resolved');
}

const GENERATED_FILE = /^[a-f0-9]{32}-[a-z]+\.[a-z]+$/;

/**
 * Remove any Photonify-generated files (uuid-alias.ext) left in `dir`.
 * Leaves fixtures and placeholder files (e.g. .DS_Store, none.ts) untouched.
 */
export function cleanGeneratedFiles(dir: string): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    if (GENERATED_FILE.test(entry)) {
      fs.unlinkSync(path.join(dir, entry));
    }
  }
}
