# apps/api/src/auth

Architecture and function reference for email/password authentication: registration and login, both returning `{ accessToken: string }` (a JWT signed via `@nestjs/jwt`).

This module owns **only** authentication concerns — token issuance/verification and orchestrating the register/login flow. User persistence lives in `src/users` (see `module-api-users.md`) and password hashing/verification lives in `src/credentials` (see `module-api-credentials.md`); `AuthService` talks to both exclusively via CQRS commands/queries (`@nestjs/cqrs`'s `CommandBus`/`QueryBus`), never by injecting their services directly. `CqrsModule.forRoot()` is registered once, globally, in `AppModule` — it's what makes `CommandBus`/`QueryBus` injectable here and discovers the `users`/`credentials` handlers app-wide, so this module doesn't import `CqrsModule` itself.

Changes here follow the Red/Green/Refactor TDD workflow in `apps/api/CLAUDE.md`: confirm `test/auth.e2e-spec.ts` (and unit specs) are green before refactoring, then re-run after each step.

## Architecture

- `AuthModule` (`auth.module.ts`) registers `JwtModule` asynchronously via `JwtModule.registerAsync`, pulling `secret` from `JWT_SECRET` (`config.getOrThrow`, so a missing secret fails startup loudly) and `signOptions.expiresIn` from `JWT_EXPIRES_IN` (default `'1h'`). Declares `AuthController` and `AuthService`.
- `AuthController` (`auth.controller.ts`) exposes `POST /auth/register` and `POST /auth/login`, both Swagger-annotated (`@ApiTags('auth')`, `@ApiOperation`, response decorators per status code). Pure pass-through to `AuthService` — no business logic in the controller.
- `AuthService` (`auth.service.ts`) orchestrates the two flows: issues a `FindUserByEmailQuery` (users module) and a `HashPasswordCommand`/`VerifyPasswordQuery` (credentials module) via `CommandBus`/`QueryBus`, then mints the JWT through this module's own `IssueAccessTokenCommand`. It does **not** touch Prisma, bcrypt or `JwtService` directly anymore.
- `commands/issue-access-token.command.ts` + `commands/issue-access-token.handler.ts` — `IssueAccessTokenCommand(userId, email, tokenVersion)`, the **one** place in the app a token is signed (D-10). Registration, login and `PATCH /profile/password` (see `module-api-profile.md`) all arrive here, so the claim set `{ sub, email, ver }` is written once and cannot drift from what `JwtStrategy` verifies. `JwtService` is injected here and nowhere else outside the strategy.
- `dto/` — `RegisterDto`, `LoginDto`, `AuthResponseDto`, a shared `normalizeEmail` `@Transform` in `transforms.ts`, and `password-rules.ts` — `PASSWORD_COMPLEXITY_REGEX`, `MIN_PASSWORD_LENGTH` (8) and `MAX_PASSWORD_LENGTH` (72), the constants every route that stores a password validates against.
- Global `ThrottlerGuard` (set up in `AppModule`, not this module) applies a default 20 req/60s per IP to every route. `login` overrides that with a stricter `@Throttle({ default: { limit: 10, ttl: 60_000 } })` since it's the brute-force target.

## Per-account revocation: the `ver` claim (D-9)

Every token this app issues carries `ver` — the account's `User.tokenVersion` at signing time — and `JwtStrategy.validate` reads it back on **every guarded request**:

- The strategy dispatches `FindUserByIdQuery(payload.sub)` and throws `UnauthorizedException` unless the row still exists **and** `(payload.ver ?? 0) === user.tokenVersion`. A verified signature is no longer sufficient on its own.
- `UpdateUserPasswordCommand` (users module) writes the new hash and `tokenVersion: { increment: 1 }` in **one** `UPDATE`, so a password change refuses every token minted before it on that token's next request (AC-13). The changing session carries on because the password route signs its fresh token _after_ the increment, from the counter the write returned.
- **A missing `ver` reads as `0`** on purpose: tokens issued before this shipped stay valid until their own `exp` instead of signing everyone out on deploy. Every account that has since changed its password is past `0`, so those tokens are refused.
- The same lookup closes a quieter hole: a deleted account's token used to stay valid until it expired.
- The cost is one primary-key read on the authentication path of every guarded route — accepted explicitly, because AC-13 promises the other sessions are refused _on their next request_ and nothing that avoids a per-request read can promise that. Rejected alternatives: `passwordChangedAt` vs the token's `iat` (one-second resolution leaves a window in which a just-stolen token survives), and a Redis denylist (Redis is optional infrastructure project-wide, and a best-effort revocation list is not a security control).

`AuthModule` therefore imports nothing new for this — `JwtStrategy` simply gains `QueryBus` — but the users module's `FindUserByIdQuery` is now on the hot path of every request the app serves.

## Hardening details (non-obvious, worth preserving)

- **Timing-safe login**: `login()` always issues a `VerifyPasswordQuery`, even when the email doesn't exist (passing `storedHash: null`). The query's handler (in `src/credentials`) falls back to a fixed dummy bcrypt hash in that case, so a lookup for an unregistered email costs the same wall-clock time as one for a registered email with a wrong password — response timing can't be used to enumerate valid accounts. See `module-api-credentials.md` for the handler-side details.
- **Registration race**: `register()` issues a `FindUserByEmailQuery` pre-check, but two concurrent registrations for the same email can both pass it. The real guard is the DB's unique constraint on `email`, enforced in `CreateUserHandler` (users module) — it catches `Prisma.PrismaClientKnownRequestError` with code `P2002` and rethrows as `ConflictException` (409). `AuthService` doesn't need to know this happened; it just propagates whatever the command throws.
- **bcrypt input cap**: both DTOs cap `password` at `MAX_PASSWORD_LENGTH = 72` (now imported from `dto/password-rules.ts`) — bcrypt only reads the first 72 bytes of its input, so anything longer is wasted (and, for unbounded input, DoS-able) hashing work. This validation stays in the DTOs (an input-boundary concern) even though the hashing itself moved to `src/credentials`.
- **Email normalization**: `normalizeEmail` (`transforms.ts`) trims and lowercases email input via `@Transform`, applied on both `RegisterDto.email` and `LoginDto.email`, so lookups/uniqueness checks aren't fooled by casing or whitespace.
- **Password complexity**: `RegisterDto.password` enforces ≥8 chars plus at least one uppercase, one lowercase, and one digit via `PASSWORD_COMPLEXITY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/`. `LoginDto.password` only checks non-empty + max length (login shouldn't reveal complexity rules). The three constants live in `dto/password-rules.ts` rather than in `RegisterDto`, because `ChangePasswordDto` (`src/profile`) has to hold the new password to **exactly** the rules registration set — two copies would drift, and a rule registration enforces but the change route does not is a way in (AC-12). The refusal **message** stays with each DTO, since it names the field it refused (`password` vs `newPassword`).
- **Consent gate**: `RegisterDto.consentToTerms` uses `@Equals(true)` — registration hard-fails unless the caller explicitly sends `true`.

## Function reference

- `AuthController.register(dto: RegisterDto): Promise<AuthResponseDto>` — delegates to `authService.register(dto)`.
- `AuthController.login(dto: LoginDto): Promise<AuthResponseDto>` — delegates to `authService.login(dto)`; `@HttpCode(200)` since Nest defaults POST to 201.
- `AuthService.register(dto): Promise<AuthResponseDto>` — queries for an existing user by email (throws `ConflictException` if found), dispatches `HashPasswordCommand`, dispatches `CreateUserCommand` (propagates `ConflictException` from the handler on a uniqueness-race loss), returns a signed token.
- `AuthService.login(dto): Promise<AuthResponseDto>` — queries for the user by email, dispatches `VerifyPasswordQuery` with the user's hash (or `null`), returns a signed token. Throws `UnauthorizedException('Invalid email or password')` for either an unknown email or a wrong password (same message/status for both, by design).
- `AuthService.signToken(userId, email, tokenVersion): Promise<string>` (private) — dispatches `IssueAccessTokenCommand`; it no longer signs anything itself.
- `IssueAccessTokenHandler.execute(command: IssueAccessTokenCommand): Promise<string>` — `jwtService.signAsync({ sub: userId, email, ver: tokenVersion })`. The secret and the expiry come from `AuthModule`'s `JwtModule` registration, not from the command.
- `JwtStrategy.validate(payload: JwtPayload): Promise<AuthenticatedUser>` — dispatches `FindUserByIdQuery(payload.sub)` and refuses (`401`) unless the row exists and `(payload.ver ?? 0) === user.tokenVersion`; otherwise returns `{ userId: payload.sub, email: payload.email }`. It is `async` now, and it reads the database — see the revocation section above.
- `normalizeEmail({ value }): unknown` (`dto/transforms.ts`) — trims + lowercases `value` if it's a string, otherwise passes it through unchanged (validation catches non-string values downstream).

## DTOs

- `RegisterDto` — `email` (validated + normalized, ≤254 chars), `password` (8–72 chars, complexity regex), `consentToTerms` (must be `true`).
- `LoginDto` — `email` (validated + normalized, ≤254 chars), `password` (non-empty, ≤72 chars, no complexity check).
- `AuthResponseDto` — `{ accessToken: string }`. Also the password route's answer (`module-api-profile.md`): the same shape, and nothing else, because the row it was built from carries the fresh hash and the revocation counter (S-1, AC-18).

## Command reference

- `IssueAccessTokenCommand(userId: string, email: string, tokenVersion: number)` → `Promise<string>`. The only token-minting path in the app. `tokenVersion` is the account's **current** counter — a caller that has just written a new one (the password route) must pass what the write returned, not what it read beforehand.

## JWT payload

`JwtPayload` (`strategies/jwt.strategy.ts`) — `{ sub: string; email: string; ver?: number }`. `ver` is optional on the **type** only because tokens minted before per-account revocation shipped do not carry it; every token issued today does, and an absent one is read as `0`.
