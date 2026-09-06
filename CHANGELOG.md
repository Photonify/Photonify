# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
  returned filename did not match the path written. See "Changed" for the new
  rule.
- **`concurrency: NaN` no longer silently produces nothing.** It previously
  spawned zero workers and resolved with an array of empty slots.

### Added

- **S3 rollback on failure.** Objects already uploaded by a failed
  `processFiles` call are now best-effort deleted, mirroring the existing local
  cleanup.
- `concurrency: Infinity` is accepted and means "no limit".

### Changed

- **Stricter input validation; these inputs used to be accepted and now
  throw.** Size aliases must match `[A-Za-z0-9_-]+` (so `thumb@2x` or `2.5x`
  are rejected). `sizes` must be non-empty, and every size must have a `width`
  and/or `height` that is a positive integer (an empty size previously
  re-encoded at full resolution). `concurrency` must be a positive integer or
  `Infinity`; `0`, negatives, and fractions previously clamped to a valid value.
  Callers relying on any of these should update before upgrading.

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
  directory has been removed; resized buffers stream straight to S3.

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

[Unreleased]: https://github.com/Photonify/Photonify/compare/v4.0.1...HEAD
[4.0.1]: https://github.com/Photonify/Photonify/releases/tag/v4.0.1
[4.0.0]: https://github.com/Photonify/Photonify/releases/tag/v4.0.0
[3.0.10]: https://github.com/Photonify/Photonify/releases/tag/v3.0.10
