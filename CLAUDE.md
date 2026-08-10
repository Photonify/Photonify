# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Photonify is a published npm package (a library, not an app) that takes image buffers, resizes them into multiple sizes with [Sharp](https://github.com/lovell/sharp), and stores the results either on the local filesystem or in AWS S3. It also supports batch-deleting files from S3.

The entire public API is two functions re-exported from `src/index.ts`:

- `processFiles(files, settings)` — `src/process_files.ts`
- `removeFiles(fileNames, settings)` — `src/remove_files.ts`

## Commands

Node version is pinned to `22.16.0` (`.nvmrc`); package manager is Yarn (Berry, `nodeLinker: node-modules`). The published package's runtime floor is Node `>=20.9.0` (`engines`); the newer dev pin is required by the ESLint 10 toolchain.

- Build: `yarn build` (cleans `dist/`, then runs `tsc`)
- Test: `yarn test` (runs Mocha)
- Run a single test: `npx mocha --grep "S3 storage"` (match against `describe`/`it` text)
- Coverage: `yarn coverage` (c8 + Mocha)
- Lint: `yarn lint` (ESLint over `**/*.ts`, flat config in `eslint.config.js`)
- Format: `yarn prettier` (Prettier over the repo; `dist/`, `node_modules/`, `tmp_*` are ignored)

S3 is mocked in tests with `aws-sdk-client-mock`; no network or credentials are needed.

## Architecture

`processFiles` is the core. Given a `Buffer` or `Buffer[]` and a `Settings` object, it produces one resized file per (image × size alias). Sizes default to `DEFAULT_SIZES` in `src/constants.ts` (`xl`/`lg`/`md`/`sm`); output format defaults to `jpg`. Output filenames are `${uuid-without-dashes}-${sizeAlias}.${format}`, and the function returns `{ createdFiles: string[] }`.

Processing is concurrency-limited (`settings.concurrency`, default 4) via a small worker pool over the flattened list of (image × size) tasks.

Storage mode (`settings.storage`) controls the write path:

- **local** (default): files are written directly to `settings.outputDest` (created with `mkdir -p` if missing). `outputDest` is required; `processFiles` throws if it's absent.
- **s3**: `processFiles` creates one shared `S3Client`, resizes each image to a Buffer (`sharp(...).toBuffer()`), and uploads it directly via `uploadFile` (`src/upload_file.ts` — a thin `PutObject` wrapper) with the format's `ContentType`. No temp files or staging directory are involved. `processFiles` throws early if `storage: 's3'` is set without both `s3Config` and `s3Bucket`, and always destroys the client in a `finally`.

On any failure, `processFiles` best-effort unlinks locally-written files and rethrows a `Photonify: Error processing images` error with the original error as its `cause`.

`removeFiles` batch-deletes S3 objects, chunking into requests of at most 1000 keys (the S3 `DeleteObjects` limit) and throwing if the response reports per-key `Errors`. There is intentionally no local-filesystem delete support — callers are expected to use `fs.unlink` themselves (see README).

The library performs no `console` logging and does not branch on `NODE_ENV`; errors propagate to the caller. `test/tmp_resized_images/` is a scratch directory for the local-storage tests.

## Gotchas

- **Use relative imports within `src/`.** There is no path-alias resolver configured for ts-node or the emitted output, so imports between modules must be relative (`./types`, `./process_files`, etc.). Avoid reintroducing a `paths` alias like `@app/*` — TypeScript's `paths` only affects type-checking and does not rewrite emitted `require()` calls, which breaks both tests and the published package at runtime.
- **`dist/` is gitignored and built on publish.** `prepublishOnly` runs `yarn build` (which cleans `dist/` first), and the `files` allowlist ships only `dist/src`. Don't commit `dist/`; don't rely on it existing in a fresh checkout.
