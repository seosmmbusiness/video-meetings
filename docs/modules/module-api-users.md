# apps/api/src/users

Owns user persistence: the Prisma `User` model. Split out of `src/auth` so that user creation/lookup and authentication (tokens, credential checks) are separate concerns — see `module-api-auth.md` for why.

This module exposes its functionality **exclusively via CQRS commands/queries** (`@nestjs/cqrs`), not by exporting `UsersModule` providers for direct injection. `UsersModule` declares no exports at all; consumers (`AuthService`, and `ProfileService` since the profile routes landed) inject `CommandBus`/`QueryBus` (from the app-wide `CqrsModule.forRoot()` registered in `AppModule`) and dispatch the command/query classes below. This keeps callers from depending on a concrete `UsersService` — they only depend on the command/query contracts.

## Architecture

- `UsersModule` (`users.module.ts`) — declares the command/query handlers as providers. No controller (this module has no HTTP surface of its own; the caller-facing profile routes live in `src/profile`, see `module-api-profile.md`).
- `commands/create-user.command.ts` + `commands/create-user.handler.ts` — `CreateUserCommand` inserts a new user row.
- `commands/update-user-name.command.ts` + `commands/update-user-name.handler.ts` — `UpdateUserNameCommand` sets or clears one row's display name.
- `commands/update-user-avatar.command.ts` + `commands/update-user-avatar.handler.ts` — `UpdateUserAvatarCommand` sets or clears one row's four avatar columns as a group.
- `queries/find-user-by-email.query.ts` + `queries/find-user-by-email.handler.ts` — `FindUserByEmailQuery` looks up a user by email.
- `queries/find-user-by-id.query.ts` + `queries/find-user-by-id.handler.ts` — `FindUserByIdQuery` looks up a user by id.
- All command/query classes extend `@nestjs/cqrs`'s `Command<T>`/`Query<T>` base classes, so `commandBus.execute(...)`/`queryBus.execute(...)` return correctly-typed results without callers needing to pass an explicit generic.

## Function reference

- `CreateUserHandler.execute(command: CreateUserCommand): Promise<User>` — inserts `{ email, passwordHash, consentToTerms }` via Prisma. Catches `Prisma.PrismaClientKnownRequestError` with code `P2002` (unique constraint on `email`) and rethrows as `ConflictException('Email is already registered')` — this is the authoritative guard against concurrent duplicate registrations; callers (e.g. `AuthService.register`) are expected to have already done a `FindUserByEmailQuery` pre-check, which narrows but doesn't eliminate the race.
- `FindUserByEmailHandler.execute(query: FindUserByEmailQuery): Promise<User | null>` — `prisma.user.findUnique({ where: { email } })`.
- `FindUserByIdHandler.execute(query: FindUserByIdQuery): Promise<User | null>` — `prisma.user.findUnique({ where: { id } })`. Returns the **whole row**, `passwordHash` and `tokenVersion` included: the response DTO at the edge — not this handler — is the boundary that decides what reaches the wire, and `tokenVersion` is here for the token-invalidation work that reads it later. A caller that answers HTTP must map field by field (`ProfileService.toResponse` is the example).
- `UpdateUserNameHandler.execute(command: UpdateUserNameCommand): Promise<User>` — `prisma.user.update({ where: { id } })`, writing `null` when the name is `null` or `''` — that is how a name is cleared (AC-4). Touches no other column: the credential and `tokenVersion` move through their own paths (D-3). Translates Prisma's `P2025` ("record to update not found") into `NotFoundException('Profile not found')`, so a still-valid access token naming a deleted row answers the same 404 the read path does instead of escaping as a 500.
- `UpdateUserAvatarHandler.execute(command: UpdateUserAvatarCommand): Promise<User>` — one `prisma.user.update({ where: { id } })` writing **all four** avatar columns together, or all four as `NULL` when the command carries `null` (D-5). They move as a group deliberately: a row holding a key without its type and size, or a size that outlives the bytes it described, is a state no read path can answer from. `avatarUpdatedAt` is stamped here rather than passed in — `apps/web` busts the avatar image's cache with it, so it has to move with the key. Touches no column outside the group, and translates `P2025` into `NotFoundException('Profile not found')` the same way the name handler does.

## Command/Query reference

- `CreateUserCommand(email: string, passwordHash: string, consentToTerms: boolean)` → `Promise<User>`. Expects an **already-hashed** password — hashing is the credentials module's job (see `module-api-credentials.md`), not this module's.
- `UpdateUserNameCommand(userId: string, name: string | null)` → `Promise<User>`. Expects an **already-normalised** name: trimming and the stripping of control/bidi characters happen in `UpdateProfileDto` (see `module-api-profile.md`), so this handler writes what it is given. `userId` always comes from a verified token.
- `UpdateUserAvatarCommand(userId: string, avatar: UserAvatar | null)` → `Promise<User>`, where `UserAvatar` is `{ key, mimeType, size }`. Expects the bytes to be **committed to storage already** and `mimeType` to be the **content-sniffed** type, never the client's declared one — the ordering and the detection are `src/profile`'s job (see `module-api-profile.md`). `null` clears the avatar. `userId` always comes from a verified token.
- `FindUserByEmailQuery(email: string)` → `Promise<User | null>`.
- `FindUserByIdQuery(userId: string)` → `Promise<User | null>`.

## Tests

`users.int-spec.ts` drives the real buses against Postgres — the create/lookup round trip, the profile columns on the `users` table (empty on a fresh row, `VarChar(80)` enforced at the column, `avatarKey` unique while every row may leave it `NULL`), and the update handlers, including that an update writes to no other account and leaves the rest of the row alone. `commands/update-user-avatar.handler.spec.ts` is the unit tier for the avatar handler: with Prisma stubbed it pins the exact key set of the `data` object — the four columns, no more and no fewer — in both directions, which is the assertion that would catch a partial write.

## Adding a new query/command

Follow the existing pairs as a template: a small `*.command.ts`/`*.query.ts` class (constructor-only, extends `Command<T>`/`Query<T>`) plus a `*.handler.ts` decorated with `@CommandHandler`/`@QueryHandler`, both registered as providers in `users.module.ts`. Add handlers only when an actual caller needs them — not speculatively.
