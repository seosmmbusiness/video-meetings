# apps/api/src/users

Owns user persistence: the Prisma `User` model. Split out of `src/auth` so that user creation/lookup and authentication (tokens, credential checks) are separate concerns — see `module-api-auth.md` for why.

This module exposes its functionality **exclusively via CQRS commands/queries** (`@nestjs/cqrs`), not by exporting `UsersModule` providers for direct injection. `UsersModule` declares no exports at all; consumers (currently only `AuthService`) inject `CommandBus`/`QueryBus` (from the app-wide `CqrsModule.forRoot()` registered in `AppModule`) and dispatch the command/query classes below. This keeps `AuthService` from depending on `UsersService` as a concrete class — it only depends on the command/query contracts.

## Architecture

- `UsersModule` (`users.module.ts`) — declares the command/query handlers as providers. No controller (this module has no HTTP surface of its own).
- `commands/create-user.command.ts` + `commands/create-user.handler.ts` — `CreateUserCommand` inserts a new user row.
- `queries/find-user-by-email.query.ts` + `queries/find-user-by-email.handler.ts` — `FindUserByEmailQuery` looks up a user by email.
- Both command/query classes extend `@nestjs/cqrs`'s `Command<T>`/`Query<T>` base classes, so `commandBus.execute(...)`/`queryBus.execute(...)` return correctly-typed results without callers needing to pass an explicit generic.

## Function reference

- `CreateUserHandler.execute(command: CreateUserCommand): Promise<User>` — inserts `{ email, passwordHash, consentToTerms }` via Prisma. Catches `Prisma.PrismaClientKnownRequestError` with code `P2002` (unique constraint on `email`) and rethrows as `ConflictException('Email is already registered')` — this is the authoritative guard against concurrent duplicate registrations; callers (e.g. `AuthService.register`) are expected to have already done a `FindUserByEmailQuery` pre-check, which narrows but doesn't eliminate the race.
- `FindUserByEmailHandler.execute(query: FindUserByEmailQuery): Promise<User | null>` — `prisma.user.findUnique({ where: { email } })`.

## Command/Query reference

- `CreateUserCommand(email: string, passwordHash: string, consentToTerms: boolean)` → `Promise<User>`. Expects an **already-hashed** password — hashing is the credentials module's job (see `module-api-credentials.md`), not this module's.
- `FindUserByEmailQuery(email: string)` → `Promise<User | null>`.

## Adding a new query/command

Follow the existing pair as a template: a small `*.command.ts`/`*.query.ts` class (constructor-only, extends `Command<T>`/`Query<T>`) plus a `*.handler.ts` decorated with `@CommandHandler`/`@QueryHandler`, both registered as providers in `users.module.ts`. Don't add a `FindUserByIdQuery` or similar speculatively — only add handlers an actual caller needs.
