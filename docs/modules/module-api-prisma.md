# apps/api/src/prisma

Architecture and function reference for the injectable Prisma client wrapper, exposed globally so feature modules don't need to re-import it, plus the generator/driver-adapter/build gotchas around it.

Changes here follow the Red/Green/Refactor TDD workflow in `apps/api/CLAUDE.md`: confirm the e2e/unit suite is green before refactoring, then re-run after each step.

## Architecture

- `PrismaModule` (`prisma.module.ts`) — `@Global()` module, provides and exports `PrismaService` only. Because it's global, any module can inject `PrismaService` without listing `PrismaModule` in its own `imports`.
- `PrismaService` (`prisma.service.ts`) — `extends PrismaClient`, implements `OnModuleInit`/`OnModuleDestroy` to connect/disconnect in step with the Nest module lifecycle. Constructed with a `PrismaPg` driver adapter (`@prisma/adapter-pg`) pointed at `DATABASE_URL` (via `ConfigService.getOrThrow`, so a missing URL fails startup loudly, not at first query).
- `prisma/schema.prisma` (repo root of `apps/api`, not under `src/`) — defines the `User`, `Meeting` and `MeetingFile` models. Generator is pinned to `prisma-client-js` (see Gotchas).
- `prisma.config.ts` (`apps/api` root) — supplies `DATABASE_URL` to the Prisma **CLI** (not the app itself), loading the monorepo-root `.env` two levels up since CLI commands run with cwd = `apps/api`.
- Generated client output: `apps/api/generated/prisma` (gitignored; produced by `npm run prisma:generate`).

## Gotchas (non-obvious, worth preserving)

- **Generator choice**: schema pins `generator client { provider = "prisma-client-js" }`, the legacy CommonJS-friendly generator — deliberately _not_ Prisma 7's new default `prisma-client` generator, which emits ESM-only TypeScript (unconditional `import.meta.url`) that doesn't run under this app's CommonJS/`ts-jest`/Nest setup. Don't switch generators without re-validating `npm run test:e2e` and a real build/start.
- **Driver adapter is required**: Prisma 7 requires an explicit driver adapter — `PrismaService` passes `new PrismaPg({ connectionString })` rather than relying on an implicit `DATABASE_URL` connection baked into the client.
- **Build gotcha**: `prisma.config.ts` lives at the `apps/api` root, outside `src/`, and must stay excluded in `tsconfig.build.json` (along with `generated/`). Including it pulls the TypeScript build's inferred `rootDir` up from `src/` to `apps/api`, which breaks `PrismaService`'s relative import of the generated client at runtime.
- **Two different `.env` consumers**: the Nest app reads `DATABASE_URL` via `ConfigService` (standard Nest config loading); the Prisma CLI reads it via `prisma.config.ts`'s explicit two-levels-up `.env` load. Keep both in sync if the env-loading strategy ever changes.

## Function reference

- `PrismaService.constructor(config: ConfigService)` — builds the Prisma client on top of a `PrismaPg` adapter using `DATABASE_URL`.
- `PrismaService.onModuleInit(): Promise<void>` — calls `this.$connect()`, logs `'Connected to the database'`.
- `PrismaService.onModuleDestroy(): Promise<void>` — calls `this.$disconnect()`.
- `PrismaModule` — no methods; a static wiring module (`providers: [PrismaService]`, `exports: [PrismaService]`, `@Global()`).

## Commands (from `apps/api`, needs `npm run db:up` first)

- `npm run prisma:generate` — regenerate the client into `generated/prisma`.
- `npm run prisma:migrate:dev` — create/apply a migration.
