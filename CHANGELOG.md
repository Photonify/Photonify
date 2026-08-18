# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[4.0.1]: https://github.com/Photonify/Photonify/releases/tag/v4.0.1
[4.0.0]: https://github.com/Photonify/Photonify/releases/tag/v4.0.0
[3.0.10]: https://github.com/Photonify/Photonify/releases/tag/v3.0.10
