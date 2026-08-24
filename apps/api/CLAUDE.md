# apps/api

NestJS 11.2.1 backend, TypeScript. Scripts: `package.json` here; the root `package.json` wraps them as `<script>:api`.

Why anything here is the way it is: [`HISTORY.md`](HISTORY.md) (repo-wide changes: [root `HISTORY.md`](../../HISTORY.md)). Per-module architecture and function references: `docs/modules/INDEX.md` (`module-api-*`) — one doc at a time, and updated in the same change as the module, per the root `CLAUDE.md`'s Module documentation section.

## Structure — what the code doesn't say

- `src/main.ts` mounts a global `ValidationPipe` (`whitelist`, `transform`) — the mass-assignment cases rely on it — and enables CORS for `apps/web`'s origin (`CORS_ORIGIN`), since the browser calls this API cross-origin in dev.
- `AppModule` registers `ConfigModule` (global, reading the monorepo-root `.env`), `CqrsModule.forRoot()` **once, app-wide**, `ScheduleModule` (the files purge cron) and a global `ThrottlerGuard` keyed on the hashed bearer token rather than the socket — so every header spelling `passport-jwt` accepts shares one bucket, and an unauthenticated call falls back to the socket. Only its baseline is configurable (`THROTTLE_LIMIT` / `THROTTLE_TTL_MS`, unusable values falling back to the default — `src/config/throttler.config.ts`); the stricter per-route overrides stay in code.
- `src/storage/` is the app-wide byte boundary (`FileStorage`, `STORAGE_ROOT` resolution, the content-based `FileTypeService`) that `files` and `profile` both import, so neither depends on the other.
- Prisma: `prisma/schema.prisma` generates into `generated/prisma` (gitignored — run `prisma:generate` locally); `prisma.config.ts` loads the root `.env` two levels up because CLI commands run with cwd=`apps/api`. Read `docs/modules/module-api-prisma.md` before touching anything Prisma-related — it carries the generator, driver-adapter and build-exclusion gotchas.
- Tests: unit specs sit next to their source as `*.spec.ts`, integration specs as `*.int-spec.ts`, e2e specs under `test/*.e2e-spec.ts`; the three Jest configs (`package.json`, `test/jest-int.json`, `test/jest-e2e.json`) are mutually exclusive by filename — see Testing.
- Own ESLint config (`eslint-plugin-prettier`) — the root `CLAUDE.md`'s Layout section says why it can't merge with `apps/web`'s.

## Conventions

- JSDoc required for all functions — see root `CLAUDE.md`.
- API documentation is generated with `@nestjs/swagger`, served at `/api` via `SwaggerModule`. Every controller/route must be annotated (`@ApiTags`, `@ApiOperation`, `@ApiResponse`, …) and every DTO field carries `@ApiProperty`/`@ApiPropertyOptional` so the generated schema stays accurate. After adding or changing a module, controller, route or DTO, run the app and check the Swagger UI before considering the work done — the generated docs must not drift from the actual API surface.
- `src/auth`, `src/users` and `src/credentials` talk to each other via CQRS (`@nestjs/cqrs`: `CommandBus`/`QueryBus`) rather than direct service injection — each exposes only command/query classes, never its providers, to keep them independently testable and replaceable. This is a deliberate choice for the identity-domain boundary, not the blanket default for every module pair: elsewhere, prefer plain constructor injection — as the `nestjs-best-practices` skill documents (`arch-single-responsibility`) when it is loaded, per the NestJS docs otherwise — unless there is a similar reason (independent domains that should stay decoupled) to reach for CQRS again.

## Testing

Three tiers, test-first and outside in, per the root `CLAUDE.md`'s Testing section — the order, the red commit, the gates and the rule that a test rewrite is confirmed with the requester first are stated there and not repeated here. What is specific to this app:

**Which tier gets what.** The dividing line is what a spec touches, not what it is about:

- **Unit** (`src/**/*.spec.ts`, `test`) — one provider's own logic with its collaborators stubbed. Construct it directly (`new QuotaReservationService(stubPrisma)`, as `src/files/quota-reservation.service.spec.ts` does) or use `Test.createTestingModule` with the collaborators overridden. No Postgres, no filesystem outside a temp dir, no HTTP. This is where branch-by-branch coverage belongs: error paths, boundary values, message wording, guard decisions.
- **Integration** (`src/**/*.int-spec.ts`, `test:int`) — real modules composed against a real boundary, without the HTTP layer. Build the module under test with `Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: '../../.env' }), CqrsModule.forRoot(), PrismaModule, TheModule] })` and call `moduleRef.init()`, which runs `PrismaService`'s `onModuleInit` and registers the CQRS handlers. This tier owns everything only a real database proves: Prisma queries and their filters, unique/foreign-key constraints (`src/users/users.int-spec.ts` covers the `P2002` → 409 translation), transactions, `@Cron` jobs driven directly, and module wiring. It follows the shared-database rules under Database.
- **E2E** (`test/*.e2e-spec.ts`, `test:e2e`) — the full `AppModule` behind supertest: status codes, response bodies, validation, guards, throttling, and the security cases below. Reserve it for what genuinely needs the whole stack; an e2e spec that reaches into a provider to set up or assert something (as `files.e2e-spec.ts` does with `FilesPurgeService`) wants to be an `*.int-spec.ts` instead.

**Security test cases are mandatory, not optional.** Alongside functional behavior, a feature/endpoint must cover: authorization boundaries (a caller can't read/modify another user's resources — IDOR); auth bypass (missing, malformed, or expired JWT against a protected route); injection/mass-assignment edge cases (extra/unexpected fields are rejected by `ValidationPipe`'s `whitelist`, not silently accepted); and rate-limiting/brute-force protection on sensitive endpoints (login, register, …). Each belongs at the tier that actually proves it — reachability through e2e, a guard's or validator's decision logic as a unit spec, an ownership `where` clause as an integration spec — and is written before implementation like any other case. `apps/web/CLAUDE.md`'s Testing section has the frontend-side equivalent.

**Which suite each gate sees.** The unit config (`rootDir: src`, `testRegex: .*\.spec\.ts$`) matches neither `*.int-spec.ts` nor `*.e2e-spec.ts` — both end in `-spec.ts`, not `.spec.ts`; `test/jest-int.json` matches only the former, `test/jest-e2e.json` only the latter. Only the unit suite is a push gate, so a red e2e or integration spec passes `pre-push` untouched while a red **unit** spec blocks it. The tiers that need Postgres are yours to run before opening a PR: `npm run db:up && npm run test:int:api && npm run test:e2e:api` from the repo root.

## Database

A local Postgres 18 and Redis 8 come from the root `docker-compose.yml` (`db:up`); connection details live in the root `.env`, and `.env.example` documents every variable. Redis is optional infrastructure with no client wired up here yet — the degrade-gracefully rule is in the root `CLAUDE.md`'s Conventions.

**Integration and e2e tests run against that same local database**, not a separate or throwaway one — deliberately, since it's already provisioned, already migrated and already what e2e uses. Two rules follow from sharing it, and both are non-negotiable: generate the data a spec depends on per run (`` `users-int-${randomUUID()}@example.com` ``, as the existing specs do) so nothing collides with a previous run or with dev data, and delete the rows a spec created in `afterAll`. Never truncate a table or reset the schema — that's someone's dev data.

## Status

Where things stand now. **How it got here — and why — is in [`HISTORY.md`](HISTORY.md)**; per-module architecture and function references are in `docs/modules/`.

- **auth** — `POST /auth/register`, `POST /auth/login` issuing JWTs, composed over CQRS with `users` (persistence) and `credentials` (bcrypt hashing/verification); `JwtAuthGuard`/`JwtStrategy` protect everything else. Every token in the app is minted by one `IssueAccessTokenCommand` and carries `{ sub, email, ver }`; the strategy reads the subject's row on each request and refuses a token whose `ver` is behind the account's `tokenVersion`, or whose account is gone — which is what makes a password change end every other session.
- **meetings** — `POST /meetings`, `GET /meetings`, `GET /meetings/:id`, guarded and scoped to the caller.
- **storage** — the app-wide byte boundary `files` and `profile` share: `FileStorage` (local disk today, `0o700`/`0o600`, stage-then-rename), `STORAGE_ROOT` resolution, and content-based type detection whose accepted set each caller passes in.
- **files** — upload, list and byte-serving under `/meetings/:meetingId/files`, owner-scoped, over the `storage` module's `FileStorage`. Every limit is enforced at the route: 500 MB per file, content-sniffed type, 20 live files per meeting, 20 GB per owner (reserved in-process for the life of an upload), plus a 60-second inactivity timeout distinct from the app's 30-minute total. Soft delete, restore and a `FilesPurgeService` cron that purges 30 days after deletion.
- **profile** — `GET`/`PATCH /profile` plus `POST`/`GET`/`DELETE /profile/avatar`, guarded, resolving the subject from the caller's token alone and answering exactly `{ id, email, name, hasAvatar, avatarUpdatedAt }`. The name is capped at 80 characters, normalised rather than rejected, and cleared by submitting an empty value. One avatar per account, at most 5 MB, PNG/JPEG/WebP by content rather than by name, stored under a fresh key per upload and served only to its owner. `PATCH /profile/password` changes the password behind the current one — the new one held to registration's rules, a wrong current one answering `403` (never `401`, which means "signed out") and changing nothing, the route capped at 10 attempts a minute like `/auth/login`, and the response carrying only the fresh token the caller continues with while every other session of the account is revoked.
- Redis is still unused.

Update this section when the current state changes, and record the change itself in `HISTORY.md`.
