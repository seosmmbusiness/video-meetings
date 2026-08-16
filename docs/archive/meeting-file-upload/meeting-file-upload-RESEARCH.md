# Research: Meeting file upload

**Key**: MFU
**PRD**: [meeting-file-upload-PRD.md](./meeting-file-upload-PRD.md)
**Plan**: [meeting-file-upload-PLAN.md](./meeting-file-upload-PLAN.md)
**Date**: 2026-08-16

## 1. TL;DR

Bytes live on local disk behind an abstract `FileStorage` class (Nest binds the abstract class as
its own DI token), so a future S3 backend is a second implementation and nothing else moves; the
DB stores a backend-agnostic `storageKey`, never a path. Multipart arrives through `multer`
(already installed under `@nestjs/platform-express`) writing to a temp directory on the same
filesystem, so the accepted file is moved into place with one atomic `rename` and every refusal
leaves nothing behind. Real file types come from `file-type@21.3.4`, already a direct dependency
of `@nestjs/common@11.1.28` — it recognises 10 of the 12 accepted extensions, and `txt`/`md`, which
carry no signature, are accepted only as valid UTF-8 text with no NUL bytes. Two new dependencies,
both chosen by the user: `@nestjs/schedule@6.1.3` for the purge cron and `@types/multer@2.2.0` for
the uploaded-file type.

The browser never talks to `apps/api` directly: `apps/web` gains two same-origin Route Handlers
that read the `httpOnly` session cookie server-side and stream the body onward, because a Server
Action is capped at 1 MB and a `<video src>` cannot carry a bearer token. Upload progress and
cancel come from `XMLHttpRequest`, the only browser API that reports upload progress. Byte serving
goes through Express 5's `res.sendFile`, which already answers `Range` with `206` so a 500 MB
recording seeks. Two things the plan could not know: `file-type` is ESM-only and cannot load under
this repo's Jest without `NODE_OPTIONS=--experimental-vm-modules` (measured both ways), and
`multer` decodes filenames as `latin1` unless told otherwise, which would mangle every non-ASCII
name. The first is written into task 2.2; the second is a Parameters row.

## 2. Decision map

| Phase | Tasks                   | Decisions                     |
| ----- | ----------------------- | ----------------------------- |
| 1     | 1.1, 1.2, 1.3, 1.4, 1.5 | D-1, D-3, D-4, D-7, D-9, D-11 |
| 2     | 2.1, 2.2, 2.3, 2.4, 2.5 | D-2, D-3, D-5, D-11           |
| 3     | 3.1, 3.2, 3.3, 3.4      | D-4, D-5, D-8                 |
| 4     | 4.1, 4.2, 4.3, 4.4      | D-6, D-7, D-10                |
| 5     | 5.1, 5.2, 5.3, 5.4, 5.5 | D-5, D-6, D-10, D-11          |
| 6     | 6.1, 6.2, 6.3, 6.4      | D-7, D-8, D-10                |

## 3. Stack as found

Versions read from the manifests and lock state on 2026-08-16, not from memory:

- **Runtime**: `.nvmrc` pins `24`; the machine runs Node **v24.16.0**. `File`, `Blob` and
  `ReadableStream` are globals — the reason the Prisma model is not called `File` (D-4).
- **`apps/api`**: NestJS **11.1.28**, `@nestjs/swagger` 11.4.6, `@nestjs/throttler` **6.5.0**,
  `@nestjs/cqrs` 11, Prisma **7.9.1** with `@prisma/adapter-pg`, `class-validator` 0.15.1.
  TypeScript config is `module: nodenext` in a CommonJS package, `target: ES2023`.
- **Already installed, no `npm install` needed**: `multer@2.2.0` and `busboy@1.6.0` (under
  `@nestjs/platform-express@11.1.28`), `file-type@21.3.4` and `load-esm@1.0.3` (direct dependencies
  of `@nestjs/common@11.1.28`), `send@1.2.1` and `content-disposition@1.1.0` (under `express@5.2.1`).
- **`apps/web`**: Next.js **16.2.12**, React 19.2.4, HeroUI 3.2.2, Playwright 1.62.1. No
  `proxy.ts`/`middleware.ts` exists — which is why route handler bodies stream (D-6).
- **Modules reused rather than rewritten**: `MeetingsService.findOneForOwner` already answers 404
  for another owner's meeting (`findFirst({ where: { id, ownerId } })`), so every file route gets
  AC-15 by calling it first — no new ownership rule is invented. `JwtAuthGuard` + `@CurrentUser()`
  cover AC-16 for every new route. `PrismaModule` is `@Global()`, so a files module injects
  `PrismaService` without importing anything. On the web side `lib/session.ts` and
  `lib/meetings-api.ts` are the shape `lib/files-api.ts` copies, and `e2e/home.spec.ts`'s
  `registerViaApi` + `signInAs` + API seeding is the fixture pattern phases 4–6 extend.
- **Infrastructure**: Postgres 18 and Redis 8 in `docker-compose.yml`; Redis stays unused — nothing
  here may hard-depend on it. Env names already taken: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`,
  `JWT_EXPIRES_IN`, `CORS_ORIGIN`, `API_BASE_URL`, `PORT`, `POSTGRES_*`, `REDIS_*`. This feature
  adds exactly one, `STORAGE_ROOT`.
- **Gap found while reading, not assumed**: `meetings.ownerId` has a foreign key but **no index**
  (`prisma/migrations/20260730162011_add_meetings/migration.sql` creates only the PK and the FK
  constraint; Postgres does not index FKs on its own). The 20 GB quota aggregates through that
  column on every upload, so the migration in task 1.1 adds it (D-4).

## 4. Decisions

### D-1. Where do file bytes live, and what owns writing, reading and deleting them?

- **Plan tasks**: 1.1, 1.2, 2.5, 3.1, 3.4
- **Options**:

  | Option                                         | Pros                                                      | Cons                                                                          | Cost to adopt         | Risk                                  |
  | ---------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------- | ------------------------------------- |
  | Abstract `FileStorage` class + local-disk impl | One seam, zero new deps, second backend is one more class | The local impl exposes an optional local-path fast path (D-7)                 | ~120 lines            | Low                                   |
  | MinIO in compose + `@aws-sdk/client-s3`        | Production-shaped from day one, presigned URLs            | New container, large dependency, presigned URLs conflict with AC-17           | New infra + 1 big dep | Scope moves past the PRD's constraint |
  | Postgres `bytea` via Prisma `Bytes`            | One store, record and bytes commit together               | 500 MB per row through the client's memory, bloated dumps, no `Range` serving | Low                   | Falsifies AC-3 and AC-10              |
  | Plain TS interface + string DI token           | Same swap story                                           | Token is a magic string; the contract is not enforced at construction         | ~120 lines            | Low                                   |

- **Chosen**: an **abstract class** `FileStorage` (`apps/api/src/files/storage/file-storage.ts`)
  used as its own Nest injection token, with `LocalDiskFileStorage` bound in `FilesModule` as
  `{ provide: FileStorage, useClass: LocalDiskFileStorage }`. Root directory from `STORAGE_ROOT`.
  Keys are backend-agnostic and server-derived: `meetings/<meetingId>/<fileId>`; the temp directory
  is `<STORAGE_ROOT>/tmp`, deliberately under the same root so the accepted file is committed with
  a single same-filesystem `fs.rename` (a cross-device rename fails with `EXDEV`).

  ```ts
  export abstract class FileStorage {
    /** Commits an already-written temp file under `key`. */
    abstract save(key: string, tempPath: string): Promise<void>;
    abstract createReadStream(
      key: string,
      range?: { start: number; end: number },
    ): Readable;
    abstract delete(key: string): Promise<void>;
    abstract stat(key: string): Promise<{ size: number } | null>;
    /** Absolute path when the backend has one, `null` otherwise (see D-7). */
    localPathFor(key: string): string | null {
      return null;
    }
  }
  ```

- **Why**: the user asked for an abstraction that carries local and S3-style backends alike. An
  abstract class is the Nest-idiomatic way to get that without a string token, it keeps the DB
  column (`storageKey`) meaningful for an object store, and it satisfies the plan's rule that
  "nothing else in `apps/api` touches storage or builds a location itself". Local disk is what the
  PRD's technical constraints allow today: no object storage, no cloud account, one machine.
- **Rejected**: MinIO + `@aws-sdk/client-s3` — new infrastructure and a heavy dependency for a
  single-machine deployment, and its natural payoff (presigned URLs) is exactly what AC-17 forbids.
  Postgres `bytea` — 500 MB values through Prisma break memory and rule out ranged playback.
  String DI token — same behaviour, weaker contract.
- **Exposure**: path traversal (AC-18) is closed structurally, not by sanitising: the key is built
  from two server-generated UUIDs and the client's name is never on the path. The storage root sits
  outside every statically served directory — `apps/api` registers no `ServeStaticModule` and never
  calls `useStaticAssets` (grepped: no hits), and Next only serves `apps/web/public`, so there is no
  URL that reaches the bytes without passing the guard (AC-17). Growth of **committed** bytes is
  bounded by the 20 GB per-owner and 500 MB per-file ceilings (D-5) — in-flight bytes were not, which
  S-3 found and task 2.4 now closes. Two things this line originally missed, both proved by S-5: the
  bytes land with Node's default file mode, world-readable on a shared host, and an unset
  `STORAGE_ROOT` falls back to a path inside the checkout, so a production deployment can put user
  files in its own source tree — hence the modes and the `getOrThrow` in Parameters. A future remote
  backend must not leak the key in error messages — keys embed meeting ids.
- **Fits in at**: `apps/api/src/files/storage/` — abstract class plus `local-disk-file-storage.ts`.
  Swapping backends means one new class and one line in `FilesModule`; callers see only the abstract
  class, and `localPathFor()` returning `null` is a supported answer with a defined fallback (D-7).
- **Sources**: `docker-compose.yml`, PRD §4; `apps/api/src/**` (no static-asset serving);
  [Nest custom providers — abstract class as token](https://docs.nestjs.com/fundamentals/custom-providers);
  `fs.rename` EXDEV behaviour — [Node fs docs](https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromisesrenameoldpath-newpath).

### D-2. How is a file's real type determined, and what happens to `txt` and `md`?

- **Plan tasks**: 2.2
- **Options**:

  | Option                                       | Pros                                               | Cons                                                                           | Cost to adopt       | Risk                          |
  | -------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------- | ----------------------------- |
  | `file-type` (already under `@nestjs/common`) | 10/12 types incl. `docx`, maintained, zero install | ESM-only: needs `load-esm`, and Jest needs `--experimental-vm-modules`         | ~60 lines           | Low, once the flag is set     |
  | Nest `ParseFilePipe` + `FileTypeValidator`   | Built in, declarative                              | Requires `file.buffer`, i.e. memory storage — 500 MB per upload in RAM         | ~10 lines           | Falsifies the 500 MB ceiling  |
  | Hand-written magic-number table              | No ESM, no flag                                    | `docx` is a ZIP: telling it from any other ZIP needs central-directory parsing | ~150 lines + upkeep | Wrong answers on `docx`/`m4a` |
  | Trust `Content-Type` / extension             | Free                                               | AC-6 explicitly requires a renamed extension to be refused                     | 0                   | Falsifies AC-6                |

- **Chosen**: `file-type@21.3.4`, reached as the transitive dependency `@nestjs/common@11.1.28`
  already pins, loaded through `load-esm@1.0.3` (also already present) and called as
  `fileTypeFromFile(tempPath)` — it reads only the first 4100 bytes, so nothing large is buffered.
  A file is accepted when the detected MIME is in the allow-list of D-5's table. `txt` and `md`
  produce no detection at all (measured: `fileTypeFromBuffer(Buffer.from('# hello markdown\n'))` →
  `undefined`), so they are accepted only when **all** of: `file-type` detected nothing, the
  declared extension is `txt` or `md`, and the first 4100 bytes decode as valid UTF-8 containing no
  NUL and no C0 control byte other than tab/LF/CR.
- **Why**: it is already installed, so the dependency budget does not move; it recognises exactly the
  10 signature-bearing types this feature accepts, `docx` included (measured against
  `supportedExtensions`); and it is the same library Nest's own `FileTypeValidator` uses, so the
  behaviour matches the framework's. The built-in validator is unusable here for one concrete
  reason: it reads `file.buffer`, which only exists under `memoryStorage`.
- **Rejected**: `ParseFilePipe`/`FileTypeValidator` — buffer-only, incompatible with a 500 MB
  ceiling. Own signature table — `docx` and the ISO-BMFF brands (`mp4`/`mov`/`m4a`) are where
  hand-rolled tables get it wrong. Extension or client MIME — AC-6 rules it out.
- **Exposure**: sniffing happens on the temp file **before** it is committed, so a rejected file is
  never in the store. A polyglot (valid PNG header, ZIP payload appended) is accepted as PNG — it is
  only ever served back with its detected type and `nosniff`, never executed. The text rule accepts
  an HTML page renamed to `.txt`: harmless only because `text/*` is never served inline —
  D-7 forces `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` for it. Worth
  the threat pass's attention as a stored-content question, not a bypass.
- **Fits in at**: `apps/api/src/files/file-type.service.ts`, one injectable with
  `detect(tempPath, declaredName): Promise<{ mime: string } | null>`; the dynamic import is the only
  place `load-esm` appears, so a later swap touches one file.
- **Sources**: `node_modules/@nestjs/common/package.json` (`"file-type": "21.3.4"`);
  `node_modules/@nestjs/common/pipes/file/file-type.validator.js` (buffer requirement and its own
  `--experimental-vm-modules` warning); `node_modules/file-type/readme.md` (`sampleSize` default
  `4100`, `fileTypeFromFile`); measured locally on 2026-08-16 — see the Jest evidence in D-11.

### D-3. How is a multipart upload taken in, and where does the 500 MB ceiling actually bite?

- **Plan tasks**: 1.3, 2.1, 2.5
- **Options**:

  | Option                                       | Pros                                                        | Cons                                                        | Cost to adopt | Risk        |
  | -------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- | ------------- | ----------- |
  | `FileInterceptor` + `diskStorage` + `limits` | Installed, streams to disk, aborts and cleans up on its own | Temp file must be committed or removed by us                | ~40 lines     | Low         |
  | `FileInterceptor` + `memoryStorage`          | `file.buffer` enables the built-in validators               | 500 MB in RAM per concurrent upload                         | ~10 lines     | Trivial DoS |
  | `busboy` directly                            | Full control of the stream                                  | Re-implements what multer already does, incl. cleanup       | ~150 lines    | Medium      |
  | Raw body + custom parser                     | No multipart at all                                         | Loses the filename part; a bespoke protocol to keep in sync | ~120 lines    | Medium      |

- **Chosen**: `FileInterceptor('file', { storage: diskStorage({ destination: <STORAGE_ROOT>/tmp,
filename: () => randomUUID() }), limits: { fileSize: 524_288_000, files: 1, fields: 0, parts: 1 },
defParamCharset: 'utf8' })`, in front of a small `UploadSizeGuard` that rejects a declared
  `Content-Length` above the ceiling before a byte is read. Two gates, and they answer the plan's
  open question — "how far the transfer is allowed to run first":
  1. **Zero bytes** when the client declares an oversize `Content-Length` (the browser always sends
     one, and the web proxy forwards it — measured in D-6).
  2. **At most the ceiling plus one busboy chunk** otherwise: multer aborts the moment its counter
     crosses `limits.fileSize`, raises `MulterError('LIMIT_FILE_SIZE')` and calls
     `removeUploadedFiles` on what it had written.

  `defParamCharset: 'utf8'` is not optional: `multer/index.js:22` reads
  `options.defParamCharset || 'latin1'`, so without it every non-ASCII filename — every Cyrillic
  one — is stored mojibake.

- **Why**: multer is already installed, already streams to disk, and already implements the two
  behaviours task 2.5 needs — it removes what it wrote both on a limit abort and on a client abort
  (`req.on('aborted')` → `handleRequestFailure` → `removeUploadedFiles`). Writing that again in
  busboy would be re-implementing a dependency we already ship.
- **Rejected**: `memoryStorage` — a 500 MB allocation per upload, and the reason the built-in
  validators are out (D-2). Direct busboy or a bespoke protocol — more code, same result.
- **Exposure**: a request that dies mid-body leaves a temp file only if the process is killed
  between multer's write and its cleanup — bounded by the `tmp` sweep in D-8. `parts: 1`/`fields: 0`
  refuse extra multipart parts, which is the multipart analogue of the `ValidationPipe` whitelist
  the repo already relies on. `Content-Length` is attacker-controlled and is therefore a fast path,
  never the authority — the stream counter is. What this line missed, and S-1 proved: `FileInterceptor`
  is an **interceptor**, so it consumes the body before the handler behind it can check who owns the
  meeting — authorization has to sit in a guard, which Nest runs first, or a stranger's 500 MB is on
  disk before the 404.
- **Fits in at**: `apps/api/src/files/files.controller.ts` (interceptor + guard) and
  `apps/api/src/files/multer.config.ts`; a `MulterExceptionFilter` maps `MulterError` codes to the
  statuses in D-5 and unlinks any temp file still present.
- **Sources**: `node_modules/multer/lib/make-middleware.js` (lines 77–124 abort/cleanup, 209–221
  `LIMIT_FILE_SIZE`), `node_modules/multer/index.js:22` (`latin1` default),
  `node_modules/@nestjs/platform-express/multer/interfaces/multer-options.interface.d.ts`.

### D-4. What does the database record look like?

- **Plan tasks**: 1.1, 1.4, 2.3, 2.4, 3.1, 3.2, 3.4
- **Options**: model named `File` vs `MeetingFile`; `size` as `Int` vs `BigInt`; owner reached
  through `Meeting` vs denormalised onto the file row.

  | Option                                    | Pros                                                               | Cons                                                                          | Cost to adopt | Risk                                    |
  | ----------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------- | --------------------------------------- |
  | `MeetingFile`, `size Int`, owner via join | No global-name clash, JSON-safe, one source of truth for ownership | Quota aggregate joins `meetings`                                              | 1 migration   | Low, once `meetings.ownerId` is indexed |
  | `File`, `size Int`                        | Matches the plan's wording                                         | Shadows Node 24's global `File` inside the one module that uses `Blob`/`File` | 1 migration   | Confusing imports                       |
  | `size BigInt`                             | Header-room past 2 GB                                              | Prisma returns JS `BigInt`; `JSON.stringify` throws on it                     | 1 migration   | Serialisation bugs in every DTO         |
  | Denormalised `ownerId` on the file        | Quota query needs no join                                          | A second copy of ownership to keep true                                       | 1 migration   | Divergence                              |

- **Chosen**: model `MeetingFile` → table `meeting_files`:

  ```prisma
  model MeetingFile {
    id         String    @id @default(uuid())
    meetingId  String
    meeting    Meeting   @relation(fields: [meetingId], references: [id], onDelete: Restrict)
    name       String    @db.VarChar(255)
    size       Int
    mimeType   String    @db.VarChar(128)
    storageKey String    @unique
    createdAt  DateTime  @default(now())
    updatedAt  DateTime  @updatedAt
    deletedAt  DateTime?

    @@index([meetingId, deletedAt])
    @@index([deletedAt])
    @@map("meeting_files")
  }
  ```

  The same migration adds `@@index([ownerId])` to `Meeting`, and `Meeting` gains
  `files MeetingFile[]`. Ownership is **not** denormalised: the quota is
  `meetingFile.aggregate({ _sum: { size: true }, where: { meeting: { ownerId } } })`.

- **Why**: `File` is a global in Node 24.16.0 (checked: `typeof File === 'function'`), and the files
  module is precisely where `File`/`Blob` might also appear — the rename costs nothing and removes
  the ambiguity. `Int` holds 500 MB (524,288,000 < 2,147,483,647) and Postgres widens `SUM(int)` to
  `bigint`, so the 20 GB total (21,474,836,480) is exact as a JS number — well under 2^53 — while
  avoiding `BigInt` DTO serialisation entirely. Ownership stays single-sourced because the plan's
  own fallback condition never triggers: with `meetings.ownerId` indexed the aggregate is one index
  scan plus a join on an indexed FK, at 20 files per meeting.
- **Rejected**: `File` — global-name clash. `BigInt` — `JSON.stringify` throws on `BigInt`, so every
  response DTO would need a converter for no gain. Denormalised owner — a second ownership fact to
  keep true, for a join Postgres does not notice.
- **Exposure**: `storageKey` is unique, so a record can never point at another record's bytes. The
  original `name` is stored as data and never used to build a path or a header verbatim (D-7). The
  `Restrict` delete rule mirrors `Meeting → User`, so a meeting cannot be deleted out from under its
  files. `mimeType` is the **detected** type, never the client's claim.
- **Fits in at**: `apps/api/prisma/schema.prisma` plus one migration under
  `prisma/migrations/`; `.claude/modules/module-api-prisma.md` and `module-api-meetings.md` gain the
  new model and the new index.
- **Sources**: `apps/api/prisma/migrations/20260730162011_add_meetings/migration.sql` (no index on
  `ownerId`); Node 24 globals checked locally; Prisma 7 aggregate typing —
  [Prisma aggregation docs](https://www.prisma.io/docs/orm/prisma-client/queries/aggregation-grouping-summarizing).

### D-5. How are the four limits enforced without a race, and what does each refusal answer?

- **Plan tasks**: 2.1, 2.2, 2.3, 2.4, 3.3, 5.5
- **Options**: check-then-write with no transaction · check inside a transaction that also creates
  the record · a `SERIALIZABLE` transaction · a DB constraint.

  | Option                                         | Pros                       | Cons                                                                                   | Cost to adopt | Risk                                      |
  | ---------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------- | ------------- | ----------------------------------------- |
  | Pre-check, then re-check inside `$transaction` | Cheap, no isolation change | Two parallel uploads can both pass the pre-check                                       | ~40 lines     | Bounded overshoot, closed by the re-check |
  | Pre-check only                                 | Simplest                   | 20 parallel uploads all see 19 files and all land                                      | ~15 lines     | Falsifies AC-7 and AC-8                   |
  | `SERIALIZABLE` isolation                       | Exact                      | Retries on conflict, and Prisma surfaces them to the caller                            | ~60 lines     | Batch uploads start failing spuriously    |
  | DB constraint                                  | Enforced by Postgres       | Neither a per-parent row count nor a per-owner byte sum is expressible as a constraint | n/a           | Not available                             |

- **Chosen**: refuse in this fixed order — declared size (guard, D-3) → streamed size (multer, D-3)
  → detected type (D-2) → live-file count → owner byte total — with the last two **repeated inside
  the `$transaction` that creates the row**, and only then the bytes committed:

  ```
  multer writes <STORAGE_ROOT>/tmp/<uuid>   →  sniff type  →  $transaction {
      count live files for the meeting            (refuse → 409)
      sum sizes for the owner                     (refuse → 507)
      create MeetingFile                          }
    →  storage.save(key, tempPath)   →  if it throws: delete the row, unlink the temp file
  ```

  Statuses and messages, which the web layer shows verbatim on the file's own row (AC-5–AC-8):
  `413` size, `415` type, `409` per-meeting cap, `507` owner quota. Task 3.3's restore refusal
  reuses the same 409 count check and the same message, which is what the plan's AC-7/AC-13 ruling
  asks for.

- **Why**: it is the cheapest arrangement that makes the plan's "nothing is left behind" clause
  true at every exit — the record cannot exist without a completed sniff, and the bytes cannot be
  in the store without a committed record. The residual race (two uploads passing the pre-check
  together) is closed by the in-transaction re-check; the worst outcome is one refused upload, not
  an over-quota account.
- **Rejected**: pre-check only — a 20-file batch is exactly the case that breaks it. `SERIALIZABLE`
  — turns a normal batch into retry storms. DB constraints — neither limit is expressible as one.
- **Exposure**: the refusal messages state a limit and, for the quota, the remaining space; none of
  them name another user, another meeting or a file id, so nothing leaks across owners. Every check
  runs **after** `findOneForOwner`, so a caller who does not own the meeting gets 404 before any
  limit is evaluated and cannot use a limit message as an oracle for whether a meeting exists. What
  this line missed, and S-3 proved: the ceilings above are evaluated when a row is committed, while
  the disk is spent while the body streams, so concurrent uploads sit outside every limit named here
  until task 2.4's reservation holds them.
- **Fits in at**: `apps/api/src/files/files.service.ts`, one `assertWithinLimits(tx, meetingId,
ownerId, size)` used by both upload and restore; the status mapping lives in the module's
  exception filter so Swagger annotations and the real responses cannot drift.
- **Sources**: `apps/api/src/meetings/meetings.service.ts` (the 404-first pattern being reused);
  [Prisma `$transaction`](https://www.prisma.io/docs/orm/prisma-client/queries/transactions);
  [RFC 9110 §15.5.14 (413)](https://www.rfc-editor.org/rfc/rfc9110#status.413),
  [§15.5.16 (415)](https://www.rfc-editor.org/rfc/rfc9110#status.415),
  [RFC 4918 §11.5 (507)](https://www.rfc-editor.org/rfc/rfc4918#section-11.5).

### D-6. How does the browser upload, given an `httpOnly` cookie and no progress from a Server Action?

- **Plan tasks**: 5.1, 5.2, 5.3, 5.4, 4.4, 6.1, 6.2
- **Options**:

  | Option                                                  | Pros                                                                       | Cons                                                                                | Cost to adopt | Risk                              |
  | ------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------- | --------------------------------- |
  | Same-origin Next Route Handler proxy + `XMLHttpRequest` | Token never leaves the server; progress, cancel and `<video src>` all work | Bytes traverse the Next process                                                     | ~80 lines     | Low (measured)                    |
  | Server Action                                           | Repo's default mutation path                                               | **1 MB body cap** by default; cannot report progress                                | ~20 lines     | Falsifies AC-2, AC-3              |
  | Browser → `apps/api` with a short-lived upload token    | One hop                                                                    | A second credential class, readable by page scripts, and it must ride in media URLs | ~150 lines    | Weakens AC-17; new attack surface |
  | `fetch` with a `ReadableStream` request body            | Modern                                                                     | No upload-progress events; request streams are Chromium-only and need HTTP/2        | ~60 lines     | Falsifies AC-3 outside Chromium   |

- **Chosen**: two same-origin Route Handlers in `apps/web`, which read the session cookie
  server-side and stream onward to `apps/api` with the bearer token attached:
  `POST /api/meetings/[meetingId]/files` and `GET /api/meetings/[meetingId]/files/[fileId]/content`.
  The client uses `XMLHttpRequest` — `xhr.upload.onprogress` for AC-3, `xhr.abort()` for AC-4, one
  request per file for AC-2. Measured on this machine on 2026-08-16, against `next dev` 16.2.12:

  - a Server Action is capped at 1 MB unless `serverActions.bodySizeLimit` is raised (docs, bundled);
  - a Route Handler **streams**: the handler was entered 194–205 ms in while the client kept sending
    until ~1250 ms (a buffering server would enter only at the end; the first run showed 930 ms,
    which was first-request compilation, not buffering);
  - `fetch(url, { body: request.body, duplex: 'half' })` in Node 24.16.0 forwards incrementally
    (first chunk at 1 ms, end at 608 ms), preserves an explicitly forwarded `content-length`, and
    propagates `AbortController` to the upstream request.

  The 10 MB `proxyClientMaxBodySize` buffer applies **only when a `proxy.ts` exists** — this app has
  none, and adding one later would silently truncate uploads (Risks).

- **Why**: it is the only option that keeps the session cookie `httpOnly` — the repo's own rule —
  while giving per-file progress and cancel, and it is needed for byte serving regardless: a
  `<video>`, `<img>` or `<iframe>` cannot attach an `Authorization` header, but it does send a
  same-origin cookie. Having built it for GET, using it for POST costs nothing extra.
- **Rejected**: Server Action — 1 MB and no progress. Upload token — puts a bearer credential in
  page JS and in media URLs (logs, `Referer`, history), which is what AC-17 exists to prevent.
  `fetch` request streams — no progress events, Chromium-only.
- **Exposure**: the proxy is an authenticated forwarder, so it must forward **nothing it was not
  asked to**: it reconstructs the upstream request from the method, the body, `content-type`,
  `content-length` and `range` only, and never echoes the caller's `Authorization`. It must attach
  the token **after** confirming a session exists, and pass the upstream status and JSON body
  through unchanged so AC-5–AC-8 messages survive. It is also an SSRF-shaped surface if the meeting
  id were ever interpolated into a host — it is not; only into the path, after `encodeURIComponent`.
- **Fits in at**: `apps/web/src/app/api/meetings/[meetingId]/files/route.ts` and
  `.../files/[fileId]/content/route.ts`, both thin; the shared attach-token-and-forward helper lives
  in `apps/web/src/lib/api-proxy.ts`. Next 16 hands `params` as a Promise
  (`ctx: RouteContext<'/api/meetings/[meetingId]/files'>`), which the handlers await.
- **Sources**: `node_modules/next/dist/docs/01-app/02-guides/server-actions.md:83`;
  `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/proxyClientMaxBodySize.md`;
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md:82-115`;
  [`XMLHttpRequestUpload: progress`](https://developer.mozilla.org/docs/Web/API/XMLHttpRequestUpload/progress_event);
  [request streams are Chromium-only](https://developer.chrome.com/docs/capabilities/web-apis/fetch-streaming-requests);
  measurements reproduced by the probes described in D-11.

### D-7. How are bytes served — download, in-page playback and preview?

- **Plan tasks**: 1.5, 4.4, 6.1, 6.2
- **Options**:

  | Option                              | Pros                                                     | Cons                                                         | Cost to adopt | Risk                                 |
  | ----------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------ | ------------- | ------------------------------------ |
  | Express `res.sendFile` (via `send`) | `Range`/`206`/`Accept-Ranges`/`If-Range`/`HEAD` for free | Needs a local path, so remote backends take the fallback     | ~30 lines     | Low                                  |
  | Nest `StreamableFile`               | Framework-native, backend-agnostic                       | No `Range` at all — `<video>` cannot seek a 500 MB recording | ~15 lines     | Poor playback, no resumable download |
  | Hand-rolled `206`                   | Backend-agnostic                                         | Suffix/multi-range and `416` are fiddly to get right         | ~70 lines     | Medium                               |

- **Chosen**: `GET /meetings/:meetingId/files/:fileId/content` on `apps/api`, ownership-checked
  first, then: set `Content-Type` from the stored `mimeType`, set `X-Content-Type-Options: nosniff`,
  set `Content-Disposition` — `inline` for `image/*`, `application/pdf`, `video/*` and `audio/*`,
  `attachment` for everything else (which is exactly AC-10's split) — and hand off with
  `res.sendFile(localPath, { acceptRanges: true, dotfiles: 'deny' })` when
  `FileStorage.localPathFor()` gives a path, falling back to `createReadStream(key, range)` with a
  hand-written `206` when it returns `null`. `send@1.2.1` keeps a pre-set `Content-Type`
  (`index.js:718`: `if (res.getHeader('Content-Type')) return`), which is what makes this safe for
  extensionless storage keys. The filename in `Content-Disposition` is produced by the
  `content-disposition` encoder (RFC 5987), never by string concatenation. The web proxy forwards
  `Range` and passes `status`, `content-range`, `content-length`, `accept-ranges`, `content-type`
  and `content-disposition` straight back.
- **Why**: seeking in a 500 MB video is a `Range` request, and `send` already implements the whole
  of it, correctly, in a dependency the repo ships. `StreamableFile` would make AC-10's playback
  technically pass while making it unusable.
- **Rejected**: `StreamableFile` — no `Range`. Hand-rolled ranges as the primary path — kept only as
  the documented fallback for a future remote backend.
- **Exposure**: this is the route AC-17 is about — it is guarded, it resolves the file through the
  meeting's owner check, and a soft-deleted or expired file answers 404 like any other unknown id
  (D-8). `inline` is granted only to the four media families above, so a `text/*` or `docx` upload
  can never be rendered as a document in the app's origin; `nosniff` stops a browser upgrading
  `application/octet-stream` into something executable. A PDF still renders in the browser's own
  viewer, which is the threat pass's to weigh — it weighed it and the user accepted it (S-8).
  `Content-Disposition` is encoded, so a filename carrying `"` or CR/LF cannot inject a header
  (AC-18's second half). What this line missed, and S-7 proved: `send` writes
  `Cache-Control: public, max-age=0` whenever the header is absent
  (`node_modules/send/index.js:746`), which labels one owner's private bytes storable by any shared
  cache — the response has to carry its own `Cache-Control` (Parameters).
- **Fits in at**: `apps/api/src/files/files.controller.ts` (`@Res()` on this route only) and
  `apps/web/src/app/api/meetings/[meetingId]/files/[fileId]/content/route.ts`.
- **Sources**: `node_modules/send/index.js` (lines 534–565 `206`/`Content-Range`, 718–724
  `Content-Type`, 741–743 `Accept-Ranges`), `node_modules/send/package.json` (1.2.1);
  `node_modules/content-disposition/package.json` (1.1.0);
  [Nest streaming files](https://docs.nestjs.com/techniques/streaming-files).

### D-8. What triggers the purge, and what happens between two ticks?

- **Plan tasks**: 3.4, 3.2, 6.4
- **Options**: `@nestjs/schedule` cron · in-process `setInterval` · purge only when something is
  read · an external cron calling an endpoint.

  | Option                      | Pros                                             | Cons                                                                  | Cost to adopt | Risk                          |
  | --------------------------- | ------------------------------------------------ | --------------------------------------------------------------------- | ------------- | ----------------------------- |
  | `@nestjs/schedule` `@Cron`  | Declarative, Nest-idiomatic, `SchedulerRegistry` | +1 dependency (+`cron@4.4.0`)                                         | ~30 lines     | Low                           |
  | `setInterval` in a provider | Zero dependencies                                | Lifecycle and `unref` by hand                                         | ~25 lines     | Low                           |
  | Read-triggered only         | Zero dependencies, zero timers                   | Bytes outlive 30 days whenever the owner stops visiting               | ~15 lines     | Falsifies AC-14's byte clause |
  | External cron → endpoint    | No in-process timer                              | A new unauthenticated-ish surface, and no scheduler exists to call it | ~40 lines     | Deployment coupling           |

- **Chosen**: `@nestjs/schedule@6.1.3`, `ScheduleModule.forRoot()` in `AppModule` and
  `@Cron(CronExpression.EVERY_HOUR)` on `FilesPurgeService.purgeExpired()` — chosen by the user.
  `purgeExpired()` is an ordinary public method: it selects files with
  `deletedAt < now − 30 days`, deletes bytes then row per file, and also removes anything older than
  24 h left in `<STORAGE_ROOT>/tmp`. The e2e spec calls it directly (`app.get(FilesPurgeService)`)
  after backdating `deletedAt`, so AC-14 is proven without waiting for a tick.

  **Between two ticks the answer must not depend on the clock**, so every read path filters on the
  horizon as well as on `deletedAt`: the deleted list returns only `deletedAt > now − 30 days`, and
  the byte route treats an expired file as absent. A file is therefore invisible and unreachable the
  instant it expires; the cron is what makes its bytes stop existing, within the hour.

- **Why**: the user chose the scheduler over a hand-rolled timer. The horizon predicate is not a
  second trigger — it is what keeps AC-14's "not retrievable by any request" true at every instant
  rather than only just after a tick, and it costs one `where` clause.
- **Rejected**: `setInterval` — the user's call. Read-triggered only — bytes survive past 30 days
  for a dormant account, which AC-14 forbids. External cron — nothing in this deployment schedules
  anything.
- **Exposure**: the purge deletes by `storageKey` read from the row, never by scanning directories,
  so a bug cannot walk out of the storage root. It runs unattended, so it logs a count and never a
  filename. On a multi-instance deployment two schedulers would race; today's target is one machine,
  and the delete-then-row order makes a double run idempotent rather than destructive.
- **Fits in at**: `apps/api/src/files/files-purge.service.ts`; `ScheduleModule.forRoot()` joins the
  imports in `app.module.ts` next to `ThrottlerModule`.
- **Sources**: `npm view @nestjs/schedule@6.1.3` — peers `@nestjs/common`/`@nestjs/core`
  `^10.0.0 || ^11.0.0`, one dependency `cron@4.4.0`, MIT, last modified 2026-04-15; package tarball
  inspected: `ScheduleModule.forRoot/forRootAsync`, decorators `@Cron`/`@Interval`/`@Timeout`,
  `SchedulerRegistry`.

### D-9. How are the file routes rate-limited when every request arrives from one IP?

- **Plan tasks**: 1.3, 1.5, 5.1
- **Options**: keep the global per-IP tracker · track by bearer token · exempt the file routes ·
  raise the global limit.

  | Option                                 | Pros                             | Cons                                                              | Cost to adopt | Risk                        |
  | -------------------------------------- | -------------------------------- | ----------------------------------------------------------------- | ------------- | --------------------------- |
  | `getTracker` keyed on the bearer token | Each session gets its own bucket | Tracks the token, not the account (a re-login opens a new bucket) | ~10 lines     | Low                         |
  | Leave the per-IP tracker               | No change                        | Every user shares one 20/60 s bucket behind the proxy             | 0             | Falsifies AC-2 for N > 20   |
  | `@SkipThrottle()` on the files routes  | Simple                           | Removes the only brake on a byte-serving endpoint                 | ~2 lines      | DoS surface                 |
  | Raise the global limit                 | Simple                           | Postpones the collapse instead of fixing it; loosens login too    | ~1 line       | Weakens brute-force defence |

- **Chosen**: give `ThrottlerModule.forRoot` a `getTracker` that keys on the caller's credential
  rather than the socket — `sha256(authorization header)` when present, `req.ip` otherwise — and
  add per-route `@Throttle` overrides on the file routes (60/min uploads, 240/min byte reads).
  `@nestjs/throttler@6.5.0` accepts `getTracker` as a module option, so no guard subclass is needed.
  Hashing rather than decoding is deliberate: `APP_GUARD` guards run **before** controller guards, so
  `req.user` does not exist yet at throttle time.
- **Why**: without it, AC-2 falls over on its own success — `apps/web` calls `apps/api`
  server-to-server, so every user's traffic shares one IP bucket, and a single 20-file batch is 20
  requests against a limit of 20 per minute for the whole installation. The same collapse already
  affects login and `GET /meetings` today; keying on the credential fixes the class of problem while
  leaving unauthenticated routes on IP exactly as they are.
- **Rejected**: skipping the throttler on file routes — the byte route is the most expensive
  endpoint in the app. Raising the global limit — loosens `/auth/login`'s 10/min brute-force brake,
  which the repo added on purpose.
- **Exposure**: the tracker key is a hash, so no token reaches the throttler's storage or its logs.
  Per-token bucketing means an attacker with many valid sessions gets many buckets — that is the
  same as many accounts, and the account-creation path keeps its own limit. Whether the per-IP
  collapse deserves a control of its own is the threat pass's call; this decision only ensures the
  feature is not broken by it.
- **Fits in at**: `apps/api/src/app.module.ts` (`ThrottlerModule.forRoot({ throttlers: [...],
getTracker })`) and the `@Throttle` decorators on `FilesController`.
- **Sources**: `node_modules/@nestjs/throttler/dist/throttler-module-options.interface.d.ts:12,19`
  (`getTracker` as an option), `dist/throttler.guard.d.ts` (`protected getTracker(req)`);
  `apps/api/src/app.module.ts:21` (20/60 s), `apps/api/src/auth/auth.controller.ts:51` (10/60 s);
  [Nest guard execution order](https://docs.nestjs.com/guards#binding-guards).

### D-10. How does the meeting page get its data, and how does it refresh after an upload?

- **Plan tasks**: 4.1, 4.3, 5.1, 6.3, 6.4
- **Options**: server-rendered page + `router.refresh()` · client-side fetching · full reload ·
  `refresh()` from `next/cache`.

  | Option                                     | Pros                                                      | Cons                                                                  | Cost to adopt | Risk                             |
  | ------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------- | ------------- | -------------------------------- |
  | Server Component + `useRouter().refresh()` | Matches the repo's no-flash rule; token stays server-side | The uploader must be a Client Component (it already is)               | ~20 lines     | Low                              |
  | Client-side fetching of the list           | Simple mental model                                       | Breaks the no-flash rule and needs a second proxy route               | ~60 lines     | Contradicts `apps/web/CLAUDE.md` |
  | `window.location.reload()`                 | Trivial                                                   | AC-2 explicitly forbids a page reload                                 | ~2 lines      | Falsifies AC-2                   |
  | `refresh()` from `next/cache`              | Newest API                                                | Server-Action-only: it throws in Route Handlers and Client Components | n/a           | Not applicable to the uploader   |

- **Chosen**: `/meetings/[id]` is a Server Component that reads the session first and redirects to
  `/login` before rendering (the repo's auth-gated rule), then loads the meeting and its files
  through a new server-only `apps/web/src/lib/files-api.ts` shaped exactly like `meetings-api.ts`.
  The uploader is a Client Component; each XHR that completes calls `useRouter().refresh()`, which
  re-renders the server list without a navigation and without losing the other rows' React state.
  Delete and restore stay **Server Actions** — no progress to report, tiny payloads — and call
  `refresh()` from `next/cache`, which is legal there.
- **Why**: it keeps the token out of the browser, keeps the list server-rendered so a reload shows
  the same thing (AC-2's second half), and uses each API where Next 16 actually permits it — checked
  against the bundled docs rather than remembered.
- **Rejected**: client-side list fetching — contradicts the no-flash rule and adds a route for
  nothing. Full reload — AC-2 forbids it.
- **Exposure**: `files-api.ts` is `server-only`, so a stray import into a Client Component fails the
  build instead of shipping the token to the browser — the same guard `auth-api.ts` already uses.
  File names render as React children, never through `dangerouslySetInnerHTML`, which is AC-18's
  first half.
- **Fits in at**: `apps/web/src/app/meetings/[id]/page.tsx`, `apps/web/src/lib/files-api.ts`,
  `apps/web/src/app/actions/files.ts`, and a client uploader under
  `apps/web/src/components/files/`.
- **Sources**: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md:46`
  (`router.refresh()`), `.../04-functions/refresh.md:13` ("can **only** be called from within Server
  Actions"); `apps/web/CLAUDE.md` (no-flash and auth-gated rules); `apps/web/src/lib/meetings-api.ts`.

### D-11. How is each promise actually proven in this repo's style?

- **Plan tasks**: 2.2, and every phase's "Done when"
- **Options**: fixtures built in code · fixtures checked in · fixtures downloaded at test time.

  | Option                                      | Pros                             | Cons                                                          | Cost to adopt | Risk                   |
  | ------------------------------------------- | -------------------------------- | ------------------------------------------------------------- | ------------- | ---------------------- |
  | Built in code + a few tiny checked-in files | No network, readable, small diff | `docx` has to be checked in                                   | ~50 lines     | Low                    |
  | All checked in                              | Simplest to read                 | Binary blobs in review, and a 100 MB file cannot be committed | —             | Repo bloat             |
  | Downloaded at test time                     | No blobs                         | Network in the test path                                      | —             | Flaky, offline-hostile |

- **Chosen**, and this is the decision that keeps phases 2 and 5 from failing on their own fixtures:
  - **`apps/api` e2e** (`test/files.e2e-spec.ts`, Red/Green/Refactor, security cases first): valid
    minimal files are built in code from their signatures — PNG (`89 50 4E 47 0D 0A 1A 0A` + IHDR),
    PDF (`%PDF-1.4`), WAV (44-byte RIFF/WAVE header), MP4/MOV/M4A (an ISO-BMFF `ftyp` box) — while
    `docx` alone is checked in under `test/fixtures/` as a few-kB real file, because it is a ZIP
    whose type is only visible from its central directory. The negative cases are the same bytes
    under a renamed extension, and a NUL-bearing blob named `.txt`.
  - **The 100 MB fixture for AC-3 must be a _valid_ file of an accepted type.** A 100 MB block of
    zeros is refused by D-2 before any progress can be observed, which would falsify the spec rather
    than the feature. The spec generates a 100 MB **WAV** (44-byte header + silence) into the OS temp
    directory in `beforeAll`, uploads it with `setInputFiles(path)`, and removes it afterwards.
  - **Backdating** for AC-14 uses `app.get(PrismaService)` inside the e2e spec to set `deletedAt`,
    then calls `FilesPurgeService.purgeExpired()` directly (D-8) — no waiting, no sleep.
  - **The suite must be able to run at all**: `file-type` is ESM-only, and under this repo's ts-jest
    setup it fails with `TypeError: A dynamic import callback was invoked without
--experimental-vm-modules` — measured on 2026-08-16, and passing with the flag set (PNG →
    `image/png`, markdown → `undefined`). Both of `apps/api`'s jest scripts therefore need
    `NODE_OPTIONS=--experimental-vm-modules`, which task 2.2 now carries. Separately,
    `npm run test:api` — the command every phase's "Done when" named — runs `apps/api`'s **unit**
    config (`rootDir: src`, `testRegex: .*\.spec\.ts$`) and does not see
    `apps/api/test/*.e2e-spec.ts` at all; the e2e suite is `npm run test:e2e --workspace apps/api`,
    which those lines now name.
- **Why**: it matches how `meetings.e2e-spec.ts` and `home.spec.ts` already work (fixtures created
  through the API, no external assets), and it front-loads the two failures that would otherwise
  surface as "the tests are green but prove nothing" (unrunnable suite) or "the feature is broken"
  (a 100 MB fixture refused for being typeless).
- **Rejected**: committing binaries wholesale — a 100 MB file cannot be committed anyway.
  Downloading fixtures — network in the test path.
- **Exposure**: fixtures are the security cases — renamed extensions, traversal names
  (`../../etc/passwd`, `..\\..\\x`), a name of script markup, another owner's meeting and file id,
  and a missing/malformed/expired token against every new route. They belong in the red phase, per
  `apps/api/CLAUDE.md`.
- **Fits in at**: `apps/api/test/files.e2e-spec.ts`, `apps/api/test/fixtures/`,
  `apps/web/e2e/meeting-files.spec.ts`; `apps/api/package.json` and the root `package.json` scripts.
- **Sources**: measured locally with a throwaway spec under `apps/api/test/` (deleted immediately
  after; `git status` verified clean) and a Next dev server on port 3999 with a throwaway route
  handler (likewise deleted); `apps/api/package.json` (jest `rootDir`/`testRegex`), root
  `package.json` (`test:api`), `.husky/pre-commit`.

## 5. Parameters and limits

Values implementation copies verbatim.

| Name                         | Value                                                                                                                                                                                            | Where                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| `MAX_FILE_BYTES`             | `524_288_000` (500 MB = 500 × 1024 × 1024)                                                                                                                                                       | multer `limits.fileSize`, guard        |
| `MAX_LIVE_FILES_PER_MEETING` | `20`                                                                                                                                                                                             | upload + restore checks                |
| `MAX_TOTAL_BYTES_PER_OWNER`  | `21_474_836_480` (20 GB), counting soft-deleted-but-not-purged files                                                                                                                             | quota check                            |
| `PURGE_AFTER_MS`             | `2_592_000_000` (30 days)                                                                                                                                                                        | purge + every read predicate           |
| `PURGE_SCHEDULE`             | `CronExpression.EVERY_HOUR`                                                                                                                                                                      | `@Cron`                                |
| `TEMP_FILE_MAX_AGE_MS`       | `86_400_000` (24 h) for orphans in `<STORAGE_ROOT>/tmp`                                                                                                                                          | purge sweep                            |
| `TYPE_SNIFF_SAMPLE_BYTES`    | `4100` (`file-type` default)                                                                                                                                                                     | `fileTypeFromFile`                     |
| `MAX_FILE_NAME_LENGTH`       | `255`, and no C0 control byte in the stored name                                                                                                                                                 | validation                             |
| multer options               | `files: 1`, `fields: 0`, `parts: 1`, `defParamCharset: 'utf8'`, `dest: <STORAGE_ROOT>/tmp`                                                                                                       | `multer.config.ts`                     |
| `STORAGE_ROOT`               | new env var; dev default `<repo>/.data/uploads`, gitignored and outside `apps/web/public`; **required** outside development — `getOrThrow`, as `DATABASE_URL` and `JWT_SECRET` already are (S-5) | `.env.example`, `LocalDiskFileStorage` |
| Storage modes                | directory `0o700`, file `0o600` — Node's default leaves uploads world-readable (S-5)                                                                                                             | `LocalDiskFileStorage`                 |
| storage key                  | `meetings/<meetingId>/<fileId>`, both server-generated UUIDs                                                                                                                                     | `FileStorage`                          |
| Byte-response caching        | `Cache-Control: private, no-store`, set before `res.sendFile` and passed through by the proxy (S-7)                                                                                              | `FilesController.content`              |
| `requestTimeout`             | `1_800_000` (30 min) on `apps/api`'s HTTP server, from Node's 300 s default — 500 MB in 300 s needs 14.0 Mbit/s, in 1800 s 2.3 Mbit/s. `headersTimeout` stays at 60 s                            | `main.ts`, before `app.listen()`       |
| Upload throttle              | `@Throttle({ default: { limit: 60, ttl: 60_000 } })`                                                                                                                                             | `FilesController.upload`               |
| Byte-read throttle           | `@Throttle({ default: { limit: 240, ttl: 60_000 } })`                                                                                                                                            | `FilesController.content`              |
| Throttler tracker            | `sha256(req.headers.authorization)` when present, else `req.ip`                                                                                                                                  | `ThrottlerModule.forRoot`              |
| Jest flag                    | `NODE_OPTIONS=--experimental-vm-modules` on `apps/api`'s `test` and `test:e2e` scripts                                                                                                           | `apps/api/package.json` (task 2.2)     |
| E2E command                  | `npm run test:e2e --workspace apps/api` — `npm run test:api` runs the unit config only                                                                                                           | every phase's "Done when"              |

**Accepted types** — a file is accepted when the detected MIME is in this table, or when nothing is
detected and D-2's text rule passes:

| Ext    | Detected MIME                                                             | Detected by `file-type` |
| ------ | ------------------------------------------------------------------------- | ----------------------- |
| `mp4`  | `video/mp4`                                                               | yes                     |
| `webm` | `video/webm`                                                              | yes                     |
| `mov`  | `video/quicktime`                                                         | yes                     |
| `mp3`  | `audio/mpeg`                                                              | yes                     |
| `wav`  | `audio/wav`                                                               | yes                     |
| `m4a`  | `audio/mp4`                                                               | yes                     |
| `pdf`  | `application/pdf`                                                         | yes                     |
| `docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | yes                     |
| `png`  | `image/png`                                                               | yes                     |
| `jpg`  | `image/jpeg`                                                              | yes                     |
| `txt`  | `text/plain` (assigned by us)                                             | **no** — text rule      |
| `md`   | `text/markdown` (assigned by us)                                          | **no** — text rule      |

**Routes and refusals** (`apps/api`; every route guarded by `JwtAuthGuard` and 404 for a meeting the
caller does not own):

| Method + path                                     | Answers                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| `POST /meetings/:meetingId/files`                 | `201` + file DTO · `413` · `415` · `409` · `507` · `404` · `401` |
| `GET /meetings/:meetingId/files`                  | `200` live files · `404` · `401`                                 |
| `GET /meetings/:meetingId/files/deleted`          | `200` deleted-not-expired, each with `purgeAt` · `404` · `401`   |
| `GET /meetings/:meetingId/files/:fileId/content`  | `200`/`206` bytes · `404` · `401` · `416`                        |
| `DELETE /meetings/:meetingId/files/:fileId`       | `204` · `404` · `401`                                            |
| `POST /meetings/:meetingId/files/:fileId/restore` | `200` + file DTO · `409` · `404` · `401`                         |

| Status | Message                                                                                               |
| ------ | ----------------------------------------------------------------------------------------------------- |
| `413`  | `File exceeds the 500 MB per-file limit.`                                                             |
| `415`  | `Unsupported file type. Accepted types: mp4, webm, mov, mp3, wav, m4a, pdf, docx, txt, md, png, jpg.` |
| `409`  | `This meeting already holds 20 files. Delete one to upload another.`                                  |
| `507`  | `Not enough space: <remaining> of the 20 GB total remains.`                                           |

**File DTO**: `{ id, meetingId, name, size, mimeType, createdAt, deletedAt, purgeAt }` — `purgeAt` is
an absolute ISO timestamp, not a countdown, so the UI's "time remaining" cannot drift with a cached
response.

**Web routes**: `POST /api/meetings/[meetingId]/files`,
`GET /api/meetings/[meetingId]/files/[fileId]/content` (proxies, D-6);
page `/meetings/[id]`; Server Actions for delete and restore.

## 6. Dependencies

| Package            | Version | Purpose                            | Weight and license                                                                       | Why nothing present does the job                                                            |
| ------------------ | ------- | ---------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `@nestjs/schedule` | `6.1.3` | Hourly purge cron (D-8)            | MIT, one dependency (`cron@4.4.0`), peers `@nestjs/common`/`@nestjs/core` `^10 \|\| ^11` | Nothing in the repo schedules anything; chosen by the user over a hand-rolled `setInterval` |
| `@types/multer`    | `2.2.0` | `Express.Multer.File` typing (dev) | MIT, depends on `@types/express` (already `^5`)                                          | `multer@2.2.0` ships no types; chosen by the user over a hand-written interface             |

Deliberately **not** installed, because they are already here: `multer@2.2.0` and `busboy@1.6.0`
(via `@nestjs/platform-express`), `file-type@21.3.4` and `load-esm@1.0.3` (direct dependencies of
`@nestjs/common@11.1.28`), `send@1.2.1` and `content-disposition@1.1.0` (via `express@5.2.1`).
Progress and cancellation need no library at all — `XMLHttpRequest` is the platform.

## 7. Architecture impact

- **New module `apps/api/src/files/`**: `FilesModule`, `FilesController`, `FilesService`,
  `FileTypeService`, `FilesPurgeService`, `storage/file-storage.ts` (abstract) +
  `storage/local-disk-file-storage.ts`, `multer.config.ts`, `dto/`. It imports `AuthModule` for the
  guard and `MeetingsModule` to reuse `findOneForOwner` — the meetings module exports the service
  for that, which is the only change it needs. New doc `.claude/modules/module-api-files.md`, a line
  in `.claude/modules/INDEX.md`, and a one-line pointer in `apps/api/CLAUDE.md`.
- **`apps/api` touched**: `prisma/schema.prisma` + one migration (D-4), `app.module.ts`
  (`ScheduleModule.forRoot()`, `getTracker`), `package.json` (two scripts, one dev dependency).
- **New surface in `apps/web`**: `app/meetings/[id]/page.tsx`, two Route Handlers under `app/api/`,
  `lib/files-api.ts`, `app/actions/files.ts`, `components/files/`. `.claude/modules/module-web-auth.md`
  is not the right home for it — a new `module-web-meeting-files.md` is, with its own INDEX line and
  a pointer in `apps/web/CLAUDE.md`. `apps/web` gains its **first** Route Handlers, which is worth a
  line in that CLAUDE.md's Conventions: they exist because a Server Action is capped at 1 MB and
  cannot report progress, not as a new default for data fetching.
- **Docs that move with the code**: root `CLAUDE.md` Status (new module, new env var, new
  dependency), `README.md` (the `STORAGE_ROOT` row), `.env.example`
  (`STORAGE_ROOT`), `.gitignore` (`/.data/`), and Swagger annotations on every new route and DTO.
- **Not touched**: Redis stays unused; CORS stays as it is (every browser call is same-origin now);
  the CQRS boundary stays inside auth/users/credentials — the files module uses plain constructor
  injection, per `apps/api/CLAUDE.md`'s own note that CQRS is not the blanket default.

## 8. Risks and open questions

- **Adding a `proxy.ts` to `apps/web` would silently truncate uploads** at 10 MB
  (`proxyClientMaxBodySize`, default 10 MB, "only applies when proxy is used"), and the request
  would _not_ fail — the handler would just see a partial body. Fallback: if one is ever added, set
  `experimental.proxyClientMaxBodySize` above `MAX_FILE_BYTES` and add an e2e case at 100 MB. Worth a
  comment in the route handler.
- **`file-type` is a transitive dependency.** `@nestjs/common@11.1.28` pins `file-type: 21.3.4`
  exactly, but a future Nest release could drop it. Fallback: declare `file-type@^21.3.4` directly in
  `apps/api` — npm dedupes it to the same install, and nothing else changes.
- **`--experimental-vm-modules` is an experimental Node flag.** It prints a warning on every test
  run and could change. Fallback: replace `file-type` with an own signature table for the 10 binary
  types and drop `docx` detection to a ZIP-plus-extension check — a real loss, so the flag is the
  better trade today.
- **Playwright uploading a real 100 MB file is not proven.** `setInputFiles(path)` is
  path-based against a local Chromium, so no protocol payload limit applies, but the spec's runtime
  is unknown — **not verified**. Fallback: raise that spec's timeout, and if it is still impractical,
  drop the fixture to the smallest size that still yields three distinct intermediate percentages and
  say so against AC-3 rather than silently weakening it.
- **Two schedulers on two instances** would race on the purge. Today's deployment is one machine;
  the delete-bytes-then-row order makes a double run idempotent. Revisit if the app is ever scaled
  out — a Redis lock is not an option while Redis stays optional.
- **For the threat pass, not settled here**: whether serving PDFs `inline` from the app's own origin
  needs a sandbox CSP; whether the per-IP collapse behind the proxy (D-9) deserves a control beyond
  the credential-keyed tracker; and whether the text rule in D-2 — which accepts an HTML file renamed
  to `.txt` — needs more than "never served inline". All three were weighed in round 2: the first was
  accepted (S-8), the second held by the credential-keyed tracker, the third held by `attachment`
  plus `nosniff`.
- **An upload slower than 14.0 Mbit/s dies on the web side at 300 s.** Node's `requestTimeout`
  defaults to 300 000 ms (measured on Node v24.16.0) and Next 16.2.12 never sets it — `keepAliveTimeout`
  is threaded through `dist/server/lib/start-server.js`, `requestTimeout` appears nowhere in
  `next/dist/server` (grepped) and no config option exposes it. `apps/api` raises its own to 30
  minutes (Parameters), but the proxy leg cannot, so a 500 MB file needs ~14 Mbit/s sustained to
  reach the API at all. Accepted by the user on 2026-08-16: a transfer cut at 300 s surfaces as
  AC-9's failed row with Retry, which is the promised behaviour. Fallbacks if that floor bites: a
  custom Next server that creates its own `http.Server`, or a reverse proxy terminating uploads —
  both change how the app is run and are the user's call, not this file's.

## 9. Plan impact

The plan stands as written except for one gap the chosen mechanisms create, which is work the plan
is missing rather than a change of shape:

- **Task 2.2 gains the flag** — `apps/api`'s jest scripts run with
  `NODE_OPTIONS=--experimental-vm-modules` (D-2: the chosen detector is ESM-only and throws under
  ts-jest without it — measured both ways). The same edit answers the open question that task
  already carried about `txt`/`md`, pointing it at D-2's text rule. No new task was minted: a phase
  allows five, phase 1 already has five, and a sixth would have meant a new phase — which is the
  user's call, not this file's.
- **The "Done when" lines of phases 1–3** now name `npm run test:e2e --workspace apps/api` for the
  cases that live in `apps/api/test`, instead of `npm run test:api`, which runs the unit config
  (`rootDir: src`) and does not see them (D-11). No task was renumbered, reworded or dropped.
- **Not written, because no decision forces it**: the root `package.json` has a script for every
  other suite (`test:api`, `test:e2e:web`) but none for the API's e2e suite. Adding `test:e2e:api`
  would be consistent, and `pre-issues` is the cheaper place to rule on it than a task here.

- **Round 2 — task 2.1 gains the raised `requestTimeout`.** That task asked how far a transfer is
  allowed to run before it is refused, and left the answer to research; hunting the parameter S-3's
  reservation depends on produced it — Node's 300 s default, which `apps/api` raises to 30 minutes.
  Written into 2.1 rather than as a new task: phase 2 also already carries five.

Nothing else moved: no phase changed order, no task became unnecessary, and no task had to split —
including task 5.1, which the plan flagged as splittable: D-6 answers both halves of it (the
`httpOnly` cookie and the missing progress channel) with one mechanism, so it stays one task. No
task the threat pass wrote was dropped or weakened in round 2.

Handed back rather than written here: whether the PRD's `docx` acceptance is worth a checked-in
binary fixture is a test-fixture call, decided in D-11; and the three items listed for the threat
pass in section 8 are `security-analyse`'s to dispose of, not this file's.

## Asked & assumed

- **Asked** — Where do the bytes physically live? → An abstract storage class covering local and
  S3-style backends alike, with the local-disk implementation built now (D-1).
- **Asked** — What triggers the purge of files deleted more than 30 days ago? → `@nestjs/schedule`
  6.1.3 with `@Cron` (D-8), accepted as a new dependency.
- **Asked** — `multer` ships no types; take `@types/multer`? → Yes, `@types/multer@2.2.0` in
  `devDependencies` (D-4, D-3), accepted as a new dev dependency.
- **Asked** (round 2) — a 500 MB upload has to clear Next's own 300 s request timeout, which Next
  exposes no way to change; raise it where we can, run a custom Next server, or put a reverse proxy
  in front? → Raise it on `apps/api` only and accept the ~14 Mbit/s floor on the proxy leg, since a
  cut transfer already surfaces as AC-9's failed row with Retry.
- **Assumed** — "500 MB" and "20 GB" mean binary multiples (524,288,000 and 21,474,836,480 bytes) ·
  if they mean decimal, three Parameters rows change and nothing else does.
- **Assumed** — The dev default for `STORAGE_ROOT` is `<repo>/.data/uploads`, gitignored · a
  production deployment sets an absolute path outside the checkout; nothing in the code depends on
  the default.
- **Assumed** — One request carries one file, as the plan states, so a batch of N is N requests ·
  this is what makes per-file progress, per-file cancel and per-file refusal messages possible at
  all.
- **Assumed** — Uploads are not resumable, per the PRD's Out of scope, so a temp file is never
  reused across requests · the tmp sweep can therefore delete anything older than 24 h without
  checking whether a client intends to come back.
- **Assumed** — The meetings module exports `MeetingsService` so the files module can reuse
  `findOneForOwner` · the alternative, re-querying `meeting.findFirst({ id, ownerId })` inside the
  files service, duplicates the one rule AC-15 depends on.

## Revisions

<!-- One line per revision round: what moved, and the finding behind it. -->

- 2026-08-16 — round 2: no decision superseded and none minted; S-1…S-8 fired only triggers 5 and 2.
- 2026-08-16 — round 2, trigger 5: D-1's **Exposure** corrected — file modes and the unset-`STORAGE_ROOT`
  fallback were missing, and the growth bound holds for committed bytes only — S-5, S-3.
- 2026-08-16 — round 2, trigger 5: D-3's **Exposure** corrected — an interceptor consumes the body
  before the handler can authorize, so ownership belongs in a guard — S-1.
- 2026-08-16 — round 2, trigger 5: D-5's **Exposure** corrected — the ceilings bind at commit while
  the disk is spent on the stream — S-3.
- 2026-08-16 — round 2, trigger 5: D-7's **Exposure** corrected — `send` labels private bytes
  `Cache-Control: public` unless the header is already set — S-7.
- 2026-08-16 — round 2, trigger 2: Parameters gained the storage modes, the byte-response
  `Cache-Control`, and `requestTimeout`; the `STORAGE_ROOT` row gained its production requirement —
  S-5, S-7, S-3.
- 2026-08-16 — round 2: task **2.1** gained the raised `requestTimeout`, the answer to the question
  that task delegated to research — D-3, opened by S-3's parameter search.
