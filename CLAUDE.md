# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Photonify is a published npm package (a library, not an app) that takes image buffers, resizes them into multiple sizes with [Sharp](https://github.com/lovell/sharp), and stores the results either on the local filesystem or in AWS S3. It also supports batch-deleting files from S3.

The entire public API is two functions re-exported from `src/index.ts`:
- `processFiles(files, settings)` — `src/process_files.ts`
- `removeFiles(fileNames, settings)` — `src/remove_files.ts`

## Commands

Node version is pinned to `20.11.0` (`.nvmrc`); package manager is Yarn (Berry, `nodeLinker: node-modules`).

- Build: `yarn build` (runs `tsc`, emits to `dist/`)
- Test: `yarn test` (runs Mocha with `NODE_ENV=test`)
- Run a single test: `NODE_ENV=test npx mocha --grep "S3 storage"` (match against `describe`/`it` text)
- Lint: `yarn lint` (ESLint over `**/*.ts`)
- Format: `yarn prettier` (Prettier over the repo; `dist/`, `node_modules/`, `tmp_*` are ignored)

## Architecture

`processFiles` is the core. Given a `Buffer` or `Buffer[]` and a `Settings` object, it produces one resized file per (image × size alias). Sizes default to `DEFAULT_SIZES` in `src/constants.ts` (`xl`/`lg`/`md`/`sm`); output format defaults to `jpg`. Output filenames are `${uuid-without-dashes}-${sizeAlias}.${format}`, and the function returns `{ createdFiles: string[] }`.

Storage mode (`settings.storage`) controls the write path:
- **local** (default): files are written directly to `settings.outputDest`.
- **s3**: files are written to a staging directory `tmp_for_upload/` (resolved as `__dirname/../tmp_for_upload`, i.e. relative to the compiled `dist/`), then each is uploaded via `uploadFile` (`src/upload_file.ts`), which reads the temp file, `PutObject`s it to `settings.s3Bucket`, and `unlink`s the temp file on success. `processFiles` fails early if `storage: 's3'` is set without both `s3Config` and `s3Bucket`.

`removeFiles` batch-deletes S3 objects (`DeleteObjectsCommand`). There is intentionally no local-filesystem delete support — callers are expected to use `fs.unlink` themselves (see README).

### Test-environment behavior

`NODE_ENV=test` short-circuits the actual S3 network calls in both `process_files.ts` (skips `uploadFile`) and `remove_files.ts` (skips the delete). The S3-path tests still create the local staging files in `tmp_for_upload/` and assert against them, so the S3 code paths are exercised up to the network boundary. `test/tmp_resized_images/` and `tmp_for_upload/` are working directories for tests.

## Gotchas

- **Use relative imports within `src/`.** There is no path-alias resolver configured for ts-node or the emitted output, so imports between modules must be relative (`./types`, `./process_files`, etc.). Avoid reintroducing a `paths` alias like `@app/*` — TypeScript's `paths` only affects type-checking and does not rewrite emitted `require()` calls, which breaks both tests and the published package at runtime.
- **`dist/` is committed** and is what's published (`main`/`types` point into `dist/`). Rebuild with `yarn build` after changing `src/` so the two stay in sync.
