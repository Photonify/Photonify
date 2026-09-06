# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [5.0.0] - 2026-09-06

### Breaking

- **Default sizes are now width-only.** When `sizes` is omitted, the defaults
  are `xl: { width: 1280 }`, `lg: { width: 1024 }`, `md: { width: 640 }`,
  `sm: { width: 320 }`, so the height follows the source aspect ratio and images
  are no longer cropped or stretched. Previously the defaults were fixed boxes
  (`xl 1280x801`, `lg 1024x768`, `md 640x480`, `sm 160x144`) that cropped to fill
  under the default `fit: 'cover'`. Pass explicit `sizes` to keep the old output.
- **Stricter input validation; these inputs used to be accepted and now
  throw.** Size aliases must match `[A-Za-z0-9_-]+` (so `thumb@2x` or `2.5x`
  are rejected). `sizes` must be non-empty, and every size must have a `width`
  and/or `height` that is a positive integer (an empty size previously
  re-encoded at full resolution). `concurrency` must be a positive integer or
  `Infinity`; `0`, negatives, and fractions previously clamped to a valid value.
  An unknown `storage` value (e.g. `'gcs'`) now throws instead of silently
  falling back to local, and non-`Buffer` entries in `files` are now rejected up
  front. (Previously values that sharp happens to accept — a file-path string or
  a `Uint8Array` — were passed through and processed; they now throw, since the
  documented input is `Buffer`.)
- **`removeFiles` takes a dedicated `RemoveSettings` type** with `storage`,
  `s3Config`, and `s3Bucket` all required, instead of `Partial<Settings>`. The
  runtime guard is unchanged; TypeScript callers passing invalid settings now
  get a type error.
- **Every rejection is a `PhotonifyError`.** Callers matching on the message
  string should branch on `err instanceof PhotonifyError` instead. The
  underlying sharp/S3 error is on `err.cause`.

### Added

- **Public types are exported from the package root.** `Settings`,
  `RemoveSettings`, `Sizes`, `Size`, `Fit`, `SupportedFileTypes`,
  `FormatOptions`, `Files`, and `ProcessResult` (plus the `PhotonifyError`
  class) are exported from `photonify` — no more deep imports from
  `photonify/dist/src/types`.
- **`webp` and `avif` output formats.**
- **`withoutEnlargement`** setting — leave images smaller than a target size at
  their original size instead of upscaling them.
- **`formatOptions`** setting — encoder options passed straight to sharp for the
  chosen `outputFormat` (e.g. `{ quality: 90 }`).
- **S3 rollback on failure.** Objects already uploaded by a failed
  `processFiles` call are now best-effort deleted, mirroring the existing local
  cleanup.
- `concurrency: Infinity` is accepted and means "no limit".

### Changed

- **Dropped the `uuid` dependency** in favor of the native
  `crypto.randomUUID()`; one fewer runtime dependency.
- **The S3 rollback is time-bounded (10s per `DeleteObjects` batch)** via
  `AbortSignal.timeout`, so an S3 outage cannot add the AWS SDK's full retry
  latency before the caller sees the original failure.
- `removeFiles` now sends `DeleteObjects` with `Quiet: true`.
- **Package metadata:** accurate `description`, added `keywords`, `homepage`,
  `bugs`, `sideEffects: false`, and an `exports` map. The exports map keeps a
  `./dist/src/*` subpath so existing deep imports (e.g.
  `photonify/dist/src/types`) still resolve, though importing types from the
  package root is now preferred.

### Fixed

- **Failure cleanup no longer races in-flight work.** When one task failed,
  cleanup ran while other workers were still writing, leaving orphan files (and
  in S3 mode, destroying the client mid-upload). `processFiles` now stops
  scheduling on the first error, waits for every in-flight task, then cleans up.
- **Cleanup also covers the write that failed.** A local write or S3 upload
  that errors after partially succeeding is now included in the rollback.
- **EXIF orientation is applied before resizing**, so phone/camera photos come
  out upright instead of sideways.
- **Size aliases could escape `outputDest`.** An alias containing `/` or `..`
  wrote outside the output directory (or produced a nested S3 key) and the
  returned filename did not match the path written. See "Breaking" for the new
  rule.
- **`concurrency: NaN` no longer silently produces nothing.** It previously
  spawned zero workers and resolved with an array of empty slots.

## [4.0.1]

### Changed

- Reconciled the license to **MIT** across `LICENSE.md`, `package.json`, and the
  README (metadata previously said ISC); corrected the copyright holder and year.
- Expanded the README badge block (npm version/downloads, CI, TypeScript, node,
  license).

### Added

- CI workflow to publish to npm on GitHub Release.

## [4.0.0]

### Breaking

- **`NODE_ENV=test` no longer skips S3 uploads/deletes.** Previously the library
  silently no-op'd S3 calls under `NODE_ENV=test`, which broke consumers running
  their app with that env. Mock the S3 client in your tests instead.
- **`s3Config` is now the AWS SDK's `S3ClientConfig`** (a widening of the old
  `{ region, credentials }` shape). Existing configs keep working and now also
  accept `endpoint`, `forcePathStyle`, etc.
- **Node `>=20.9.0` is now required** (previously lower), as required by sharp 0.35.
- **S3 uploads go directly to the bucket.** The `tmp_for_upload` staging
  directory has been removed; resized buffers are uploaded straight to S3.

### Added

- `ContentType` is now set automatically on S3 uploads based on the output format.

### Changed

- Expanded the test suite (4 → 28 tests).
- Resolved all outstanding Dependabot vulnerabilities.

See the [v4.0.0 release notes](https://github.com/Photonify/Photonify/releases/tag/v4.0.0)
for the full list.

## [3.0.10]

- Final 3.x release. See the
  [3.x release notes](https://github.com/Photonify/Photonify/releases) for details.

[Unreleased]: https://github.com/Photonify/Photonify/compare/v5.0.0...HEAD
[5.0.0]: https://github.com/Photonify/Photonify/compare/v4.0.1...v5.0.0
[4.0.1]: https://github.com/Photonify/Photonify/releases/tag/v4.0.1
[4.0.0]: https://github.com/Photonify/Photonify/releases/tag/v4.0.0
[3.0.10]: https://github.com/Photonify/Photonify/releases/tag/v3.0.10
