# apps/api/src/storage

Owns **byte storage for the whole app**: the abstract `FileStorage` boundary every read, write and
delete of a file's bytes goes through, its local-disk implementation, the `STORAGE_ROOT` resolution
both of them lean on, and the content-based `FileTypeService` that decides what a staged upload
really is.

It exists because two features need bytes and neither should depend on the other (D-4). The four
files moved out of `src/files/` unchanged when `profile` needed an avatar: the alternative —
`FilesModule` exporting `FileStorage` and `FileTypeService` — would have made a self-service profile
route import the meeting-files controller, its hourly purge cron and its quota reservation service;
the other alternative, a second disk path and a second sniffer inside `profile`, is exactly the
duplication `FileStorage` exists to prevent.

The module holds **no HTTP surface, no Prisma and no feature policy**. It does not know what a
meeting file or an avatar is: keys are opaque strings its callers build, and the accepted MIME set
is a parameter its callers pass (`files` its twelve, `profile` its three).

## Architecture

- `StorageModule` (`storage.module.ts`) — binds `{ provide: FileStorage, useClass: LocalDiskFileStorage }`
  and provides `FileTypeService`, **exporting both**. `FilesModule` and `ProfileModule` import it.
- `file-storage.ts` — the abstract `FileStorage` class (`save`, `createReadStream`, `delete`,
  `stat`, `localPathFor`), used as its own Nest injection token so a future backend is one new class
  plus one line in `StorageModule`.
- `local-disk-file-storage.ts` — the only implementation today. Root directory from `STORAGE_ROOT`
  via injected `ConfigService` (required, no default, under `NODE_ENV=production`). Creates the root
  and `<root>/tmp` at `onModuleInit` with mode `0o700`; commits a file with `fs.rename` (same
  filesystem as the temp dir, so this is atomic) followed by `chmod 0o600`.
- `storage-root.ts` — `resolveStorageRoot()`, a plain function (not DI) reading `process.env`
  directly, for the callers that run outside the DI container. See Gotchas — it must stay lazy.
- `file-type.service.ts` — content-based type detection (D-2): `file-type`'s signature detection
  first, a text-content rule (`txt`/`md` only) as the fallback for the two extensions that carry no
  signature at all. Takes the accepted set as a parameter (D-4).
- `storage.constants.ts` — `TYPE_SNIFF_SAMPLE_BYTES` (4100, `file-type`'s own default sample size)
  and `TEXT_FILE_EXTENSIONS` (`txt`/`md`). Feature limits — the accepted MIME maps, the size
  ceilings, the refusal messages — deliberately stay in `files.constants.ts` and
  `profile.constants.ts`, not here.

## Modes and layout (non-obvious, worth preserving)

- **`0o700` directories, `0o600` files.** Both are set explicitly rather than left to the process
  umask, so uploaded bytes are unreadable to every other account on the host. The `chmod` after the
  rename matters as much as the `mkdir` mode: multer creates the temp file with its own permissions,
  and the rename carries those across.
- **Uploads are staged, then committed.** Multer writes into `<root>/tmp`; `save()` renames from
  there into the key's path. Same filesystem means the rename is atomic, so a reader never sees a
  half-written object. It also means a refusal (a size or type gate) simply unlinks a temp file and
  no partially stored object exists to clean up.
- **Keys are opaque and server-generated.** `meetings/<meetingId>/<fileId>` and
  `users/<userId>/avatar/<uuid>` (D-7) both consist of ids this app made up; no caller-supplied
  segment reaches `pathFor()`, so there is nothing to traverse with.

## Gotchas (non-obvious, worth preserving)

- **`STORAGE_ROOT` resolution is duplicated on purpose, and `resolveStorageRoot()` must stay lazy.**
  `LocalDiskFileStorage`'s constructor reads it via injected `ConfigService` (idiomatic,
  DI-testable — see its unit spec). Multer's `diskStorage` `destination` callback cannot use DI at
  all: `buildMulterOptions()` / `buildAvatarMulterOptions()` run once, synchronously, when
  `FilesController` / `ProfileController` are **decorated** — which happens while `AppModule`'s own
  `imports` array (containing `ConfigModule.forRoot(...)`) is still being evaluated, i.e. before the
  root `.env` has been loaded. Reading `process.env.STORAGE_ROOT` at that point would see it unset
  even when `.env` does set it. The fix is deferral, not DI: the `destination` callback itself runs
  per request, long after bootstrap, so calling `resolveStorageRoot()` from inside it is safe.
  Hoisting that call out of the callback — "resolving it once, for clarity" — is the regression this
  note exists to prevent.
- **The accepted MIME set is a parameter, never a constant in here.** `detect()` takes the caller's
  extension → MIME map and refuses anything outside its **values**, the text fallback included: a
  caller whose set holds no text type (the profile's three images) refuses a genuine `.txt` too,
  rather than accepting a type it never asked for. One detector, two policies, nothing to keep in
  step.
- **`file-type` is ESM-only.** `FileTypeService` reaches it through `load-esm`'s `loadEsm()` (already
  a transitive dependency of `@nestjs/common`, the same path Nest's own `FileTypeValidator` uses),
  which needs `NODE_OPTIONS=--experimental-vm-modules` — carried on both of `apps/api`'s `test` and
  `test:e2e` npm scripts, not just `test:e2e`.
- **`localPathFor` may legitimately return `null`.** The base class answers `null` for a backend with
  no local path; only `LocalDiskFileStorage` overrides it. A caller that needs a path (both byte
  routes do, since they `res.sendFile`) has to handle that — `ProfileService.getAvatarFile` answers
  `500` rather than guessing a path.
- **A caller passing an absolute path where a key belongs would escape the root.** `pathFor()` is a
  plain `join(root, key)`. Every key in the app is server-generated, which is what makes that safe;
  a future caller building a key from user input has to sanitise it before it gets here.

## Function reference

- `FileStorage.save(key, tempPath): Promise<void>` (abstract) — commits an already-written temp file
  under `key`.
- `FileStorage.createReadStream(key, range?): Readable` (abstract) — opens a read stream for `key`.
- `FileStorage.delete(key): Promise<void>` (abstract) — deletes `key`'s bytes if present.
- `FileStorage.stat(key): Promise<{ size: number } | null>` (abstract) — the stored size, or `null`
  when the object is absent.
- `FileStorage.localPathFor(key): string | null` — absolute local path when the backend has one;
  the base implementation returns `null`.
- `LocalDiskFileStorage.onModuleInit(): Promise<void>` — `mkdir`s the root and `<root>/tmp` at
  `0o700`.
- `LocalDiskFileStorage.save(key, tempPath): Promise<void>` — `mkdir` the destination's parent
  (`0o700`), `rename` the temp file into place, `chmod 0o600`.
- `LocalDiskFileStorage.createReadStream(key, range?)` / `.delete(key)` / `.stat(key)` /
  `.localPathFor(key)` — thin wrappers over `fs`/`fs/promises`, all keyed through the same private
  `pathFor(key)`. `delete` uses `rm(..., { force: true })`, so removing an absent object is not an
  error.
- `resolveStorageRoot(): string` (`storage-root.ts`) — the absolute root from `STORAGE_ROOT`, or a
  dev-only default under the repo root; throws when it is unset while `NODE_ENV` is `production`.
  See Gotchas.
- `FileTypeService.detect(tempPath, declaredName, acceptedMimeTypes): Promise<DetectedFileType | null>` —
  signature detection via `file-type`, falling back to the text-content rule (private `looksLikeText`)
  only for a declared `txt`/`md` extension when no signature was found at all, and only when the
  caller's accepted set contains that text type. Returns `null` — never throws — when the content is
  not something the caller accepts; the refusal status is the caller's to choose.
- `FileTypeService.readSample(tempPath): Promise<Buffer>` (private) — reads up to
  `TYPE_SNIFF_SAMPLE_BYTES` from the start of the temp file.
- `looksLikeText(sample): boolean` (module-private) — valid UTF-8, no NUL, and no C0 control byte
  besides tab/LF/CR.

## Tests

| Tier | File                              | Covers                                                                                                                                                                  |
| ---- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit | `local-disk-file-storage.spec.ts` | Root resolution (the dev default, and the production throw when `STORAGE_ROOT` is unset) and the `0o700`/`0o600` modes on the root, its `tmp` dir and a committed file. |
| Unit | `file-type.service.spec.ts`       | Signature detection, the `txt`/`md` fallback and its UTF-8/control-byte rule, and the parameterised accepted set refusing a type the caller never listed.               |

The consumers' suites are the other half of the proof: every `files` spec passed unchanged across
the extraction (D-4's stated risk was the move, not the result), and `profile.int-spec.ts` exercises
the same boundary from the avatar side.
