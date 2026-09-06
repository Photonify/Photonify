# Photonify review backlog

Findings from a full code review on 2026-09-05. Baseline: lint, build, and all
32 tests pass; coverage is 98.8%; `yarn audit` reports 0 vulnerabilities.
Items are ordered by priority within each section. Check items off as they land.

## P0 — Bugs (all reproduced against the built package)

- [x] **Failure cleanup races in-flight workers** (`src/process_files.ts:94-121`).
      `Promise.all` rejects on the first failed task while other workers are still
      mid-write. The `catch` unlinks `writtenLocalPaths` and rethrows, then the
      in-flight tasks finish and write new files that are never cleaned up. Repro:
      `[badBuffer, good, good, good]` with `concurrency: 4` leaves 6 files behind.
      In S3 mode the same race means `client.destroy()` runs while uploads are
      still in flight. Fix: on first error stop scheduling new tasks, `await` all
      workers (`Promise.allSettled` or a settled flag), then clean up and throw.
- [x] **EXIF orientation is dropped** (`src/process_files.ts:72`). sharp strips
      metadata by default but does not auto-rotate, so a phone photo tagged
      `orientation: 6` comes out sideways. Repro: 400x200 source with
      orientation 6 resizes to 100x50 with no orientation tag (expected portrait).
      Fix: call `.rotate()` before `.resize()`.
- [x] **Size alias is interpolated into the output path unvalidated**
      (`src/process_files.ts:70,86`). An alias containing `/` or `..` produces a
      file outside `outputDest` (or a nested S3 key), and the name in
      `createdFiles` does not match the path actually written. Fix: validate
      aliases against a safe pattern such as `/^[A-Za-z0-9_-]+$/` and throw.
- [x] **`concurrency: NaN` silently produces nothing** (`src/process_files.ts:48,104`).
      `Math.max(1, NaN)` is `NaN`, `Array.from({ length: NaN })` is empty, so no
      workers run and the result is `{ createdFiles: [null] }`. Fix: validate
      `concurrency` is a positive integer (`Number.isInteger(n) && n >= 1`).
- [x] **Empty size `{}` silently re-encodes at full resolution**
      (`src/process_files.ts:56`). A size with neither `width` nor `height`
      produces a 3264x4912 output. Decision: throw a validation error.

## P1 — Correctness, API, and robustness

- [ ] **Export types and `ProcessResult` from `src/index.ts`.** README currently
      tells users to deep-import from `photonify/dist/src/types`. Export
      `Settings`, `Sizes`, `Size`, `Fit`, `SupportedFileTypes`, `Files`,
      `ProcessResult` and update the README TypeScript section.
- [ ] **Introduce a `PhotonifyError` class and use it consistently.**
      `processFiles` wraps with `cause`; `removeFiles` sniffs
      `error.message.startsWith('Photonify:')` and flattens the message
      (`src/remove_files.ts:43-51`). A single exported error class with `cause`
      removes the string sniffing and gives callers something to `instanceof`.
- [ ] **Validate `storage` and `files` inputs.** An unknown `storage` value
      (e.g. `'gcs'`) silently falls back to local. Non-Buffer entries in `files`
      surface only as a wrapped sharp error. Throw early with clear messages.
- [x] **Use `fs.promises` instead of `mkdirSync`/`unlinkSync`** inside the async
      function. Also narrow `outputDest` / `s3Bucket` once into local consts
      instead of repeated `as string` casts. (Done as part of the P0 rewrite.)
- [x] **Implement S3 partial-failure cleanup.** On failure only local files are
      removed; already-uploaded S3 objects are left behind. Decision: after all
      workers settle, best-effort `DeleteObjects` the uploaded keys (ignore
      cleanup errors), then rethrow. Document in the README error-handling
      section.
- [ ] **Replace the `uuid` dependency with `crypto.randomUUID()`.** Node
      `>=20.9.0` ships it natively; this drops a runtime dependency.
- [ ] **Add `webp` and `avif` output formats.** Only `jpg`/`png`/`tiff` are
      supported; adding entries to `CONTENT_TYPES` / `SHARP_FORMATS` is enough.
- [ ] **Expose `withoutEnlargement` and per-format encoder options** (e.g. JPEG
      `quality`). Small images are currently upscaled to fill each size, and
      quality is not configurable. Additive, non-breaking `Settings` fields.
- [ ] **`removeFiles` takes `Partial<Settings>`** but `Settings` is already
      all-optional; tighten to a dedicated `RemoveSettings` type. Consider
      `Quiet: true` on `DeleteObjectsCommand` to shrink responses.

## P2 — Tests

- [x] Add regression tests for each P0 bug above (cleanup race with
      `concurrency > 1`, EXIF rotation, alias validation, `concurrency` validation,
      empty size).
- [x] Assert `error.cause` is the original sharp/S3 error in the failure tests.
- [x] Assert that S3 mode writes nothing to disk (the test name at
      `test/process_files.test.ts:270` claims it but nothing checks it).
- [x] Test that `processFiles` destroys the S3 client on both success and
      failure (only `removeFiles` has this test).
- [ ] Test that the concurrency limit is actually honored (track max in-flight
      `PutObject` calls via the mock).
- [ ] Cover `fit`, `tiff`, and a per-key `Errors` batch in the second chunk of a
      `removeFiles` call.
- [x] `test/helpers.ts:26` regex `[a-z]+` misses aliases with digits or
      uppercase; the doc comment still references a `none.ts` placeholder that
      no longer exists.
- [ ] Add a Mocha `timeout` (e.g. 10s) in `.mocharc.json` so sharp-heavy tests
      do not flake on slow CI runners.

## P3 — Tooling and CI

- [ ] **Reconcile the package manager.** `yarn --version` is 1.22.22 and
      `yarn.lock` is v1 (classic), but `.yarnrc.yml`, `.yarn/install-state.gz`,
      and `CLAUDE.md` all describe Yarn Berry. Either commit to Berry (add
      `packageManager`, `yarnPath`, regenerate the lockfile, switch CI to
      `--immutable`) or delete `.yarnrc.yml`/`.yarn` and fix `CLAUDE.md`.
      Decision: stay on classic; delete the Berry files, add
      `"packageManager": "yarn@1.22.22"`, fix the docs.
- [ ] **Modernize `tsconfig.json`.** `target: ES6` is far below the Node 20
      floor; move to `ES2022` (native async/await, typed `Error.cause`, smaller
      output). Consider `moduleResolution: node16`, `isolatedModules`,
      `noUncheckedIndexedAccess`. Drop `declarationMap` (the maps point at `src/`
      which is not shipped) or ship `sourceMap` too.
- [ ] **Use the installed but unused lint presets.** `@eslint/js` and
      `typescript-eslint` are devDependencies but `eslint.config.js` ignores
      them. Adopt `tseslint.configs.recommendedTypeChecked`, and move `ignores`
      into its own global config object (nested under `files` it is not global).
- [ ] **Add `prettier --check` to CI** and a `prettier:check` script; formatting
      is currently unenforced.
- [ ] **Test across the supported Node range.** CI runs only on the 22.16 dev
      pin while `engines` allows `>=20.9.0`; add a matrix for 20, 22, 24.
- [ ] **Bump pinned dev deps.** `typescript` is exact-pinned at 5.3.3 (5.9.x is
      current within the 5.x line); `@types/chai`, `@types/mocha`, `c8`, `mocha`
      have majors available. `chai` 5+ is ESM-only, so stay on chai 4 until
      the `node:test` migration (P5).
- [ ] **Re-evaluate `resolutions`** for `serialize-javascript` and `diff` after
      dependency bumps; they may no longer be needed.
- [ ] **Add `.github/dependabot.yml`** (grouped npm + actions updates) and an
      `.editorconfig`.
- [ ] **Publish workflow:** consider npm trusted publishing (OIDC) and dropping
      the `NPM_TOKEN` secret; already using `--provenance`.
- [ ] Enforce coverage thresholds via `.c8rc.json` (`check-coverage`).

## P4 — Package metadata and docs

- [ ] `package.json` `description` is stale ("manage multipart image uploads
      ... fingerprinting"); the library does not touch multipart. Add
      `keywords`, `homepage`, `bugs`, `sideEffects: false`, and
      `packageManager`. Consider an `exports` map (keep a `./dist/src/*` subpath
      for backward compatibility with existing deep imports).
- [ ] README: "Streams resized buffers straight to S3" is inaccurate; each
      variant is fully buffered then uploaded. `concurrency` is described as
      "images processed in parallel" in README, `src/types.ts:27`, and
      `src/constants.ts:22` but it bounds (image x size) tasks.
- [ ] README: document alias rules, orientation handling, S3 partial-failure
      behavior, and the new exported types once the P1 items land.
- [ ] `CLAUDE.md`: fix the Yarn Berry claim (see P3) and mention `TODO.md`.
- [x] `DEFAULT_SIZES.xl` is 1280x801 (`src/constants.ts:6`). Decision: leave
      unchanged (no behavior change).
- [ ] Local cruft: `tmp_for_upload/` (removed from the library in 4.0.0) still
      exists on disk with only a `.DS_Store`; delete it.

## Decisions (resolved 2026-09-05)

1. **Package manager:** stay on Yarn classic. Remove `.yarnrc.yml` and `.yarn/`,
   add `packageManager`, fix `CLAUDE.md`.
2. **Empty size `{}`:** throw a validation error (require width or height).
3. **`xl` default 1280x801:** leave unchanged.
4. **S3 partial failure:** best-effort `DeleteObjects` of already-uploaded keys
   after all workers settle, then rethrow.
5. **Test runner:** keep Mocha + Chai for now. Migration to `node:test` is
   queued as a dedicated later task (see P5).

## P5 — Queued for a dedicated run

- [ ] **Migrate tests to `node:test`.** Drop mocha, chai, ts-node, c8 and their
      `@types`; use `node:test`, `node:assert/strict`, Node's built-in type
      stripping and `--experimental-test-coverage`. Rewrite the three test files
      and `test/helpers.ts`; update `.mocharc.json` (remove), `scripts`, and CI.

## Subagent review of PR #8 (Fable 5.1, high effort, 2026-09-06)

Branch `fix/p0-process-files-bugs`. The reviewer confirmed all 8 new regression
tests fail on the old `src/process_files.ts` and pass on the new one, and that
the worker pool, `.rotate()`, validation order, and `Object.entries` handling
are correct. Findings, with my verdict and status:

- [ ] **1. Rollback omits the key/path whose write threw** (`src/process_files.ts`
      runTask). `uploadedKeys.push` / `writtenLocalPaths.push` run only after the
      I/O resolves, so a PutObject that fails after S3 stored the body, or a
      `toFile` that fails mid-write, leaves an orphan. CONFIRMED by reviewer.
      **Agree.** Fix: push before the `await`; cleanup already tolerates
      missing keys/files.
- [ ] **2. Stricter validation is a behavior change, not just a fix.**
      `concurrency: 0` / fractions used to clamp and `Infinity` meant unbounded;
      aliases with `.`/`@` and `sizes: {}` used to work. CHANGELOG lists these
      only under "Fixed". **Agree.** Fix: accept `Infinity` as unbounded; move
      the rest to a "Changed" entry; note the release should be at least a
      minor bump (user's call: 4.1.0 vs 5.0.0).
- [ ] **3. Race test runs ~1.26s against Mocha's 2s default timeout.**
      **Agree.** Fix: `"timeout": 10000` in `.mocharc.json` (P2 item).
- [ ] **4. `sizes: {}` silently returns `{ createdFiles: [] }`.** Same class as
      the NaN bug. **Agree.** Fix: throw when `sizes` has no entries; test + README.
- [ ] **5. `String(value)` in error messages throws on null-prototype objects.**
      **Agree** (cheap). Fix: `util.inspect(value)`.
- [ ] **6. Rollback `DeleteObjects` has no time bound**, so an S3 outage adds
      SDK retry latency before the caller sees the rejection. **Partly agree.**
      Document in README; a configurable abort timeout is deferred (P1 candidate).
- [ ] **7. TODO.md / CHANGELOG stale.** P4 items about `concurrency` wording and
      README alias/orientation/S3 docs are done but unchecked; CHANGELOG's
      `[null]` wording. **Agree.** Fix: check off, reword.
- [ ] **8. Alias regex rejects `.` and `@`** (e.g. `thumb@2x`, `2.5x`); no length
      cap. **Disagree / keep.** Product choice: keeping the character set
      minimal is simpler and documented. Revisit if users report breakage.
- [ ] **9. Coverage gaps:** concurrency limit still unasserted (P2 item);
      >1000-key rollback chunk loop untested. **Agree on the first.** Fix: add a
      max-in-flight test via the S3 mock. Skip the chunk-loop test.
