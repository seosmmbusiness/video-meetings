# apps/api/src/credentials

Owns password hashing and verification (bcrypt) — including the timing-safe dummy-hash comparison used when no matching user exists. Split out of `src/auth` so that credential handling is independent of both token issuance (`src/auth`) and user persistence (`src/users`) — see `module-api-auth.md` for why.

Like `src/users`, this module exposes its functionality **exclusively via CQRS commands/queries** (`@nestjs/cqrs`). `CredentialsModule` declares no exports; consumers inject `CommandBus`/`QueryBus` and dispatch the command/query classes below.

## Architecture

- `CredentialsModule` (`credentials.module.ts`) — declares the command/query handlers as providers. No controller.
- `commands/hash-password.command.ts` + `commands/hash-password.handler.ts` — `HashPasswordCommand` bcrypt-hashes a plaintext password.
- `queries/verify-password.query.ts` + `queries/verify-password.handler.ts` — `VerifyPasswordQuery` timing-safe-compares a plaintext password against a stored hash (or `null`).

## Hardening details (non-obvious, worth preserving)

- **Timing-safe verification**: `VerifyPasswordHandler` always calls `bcrypt.compare`, even when `storedHash` is `null` — against a fixed `DUMMY_PASSWORD_HASH` constant (a bcrypt hash of an unused password). This means a verification for a nonexistent account costs the same wall-clock time as one for a real account with a wrong password, so response timing can't be used to enumerate valid accounts. Callers (`AuthService.login`) are responsible for always issuing this query — even when they already know the user doesn't exist — rather than short-circuiting before it.
- **bcrypt salt rounds**: `BCRYPT_SALT_ROUNDS = 12`, set in `hash-password.handler.ts`.
- The 72-byte input cap on passwords is enforced upstream, in the DTOs (`src/auth/dto`) — it's an input-validation boundary concern, not something this module needs to guard against itself.

## Function reference

- `HashPasswordHandler.execute(command: HashPasswordCommand): Promise<string>` — `bcrypt.hash(password, BCRYPT_SALT_ROUNDS)`.
- `VerifyPasswordHandler.execute(query: VerifyPasswordQuery): Promise<boolean>` — `bcrypt.compare(password, storedHash ?? DUMMY_PASSWORD_HASH)`.

## Command/Query reference

- `HashPasswordCommand(password: string)` → `Promise<string>` (the bcrypt hash).
- `VerifyPasswordQuery(password: string, storedHash: string | null)` → `Promise<boolean>`.
