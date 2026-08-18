# apps/api/src/auth

Architecture and function reference for email/password authentication: registration and login, both returning `{ accessToken: string }` (a JWT signed via `@nestjs/jwt`).

This module owns **only** authentication concerns — token issuance/verification and orchestrating the register/login flow. User persistence lives in `src/users` (see `module-api-users.md`) and password hashing/verification lives in `src/credentials` (see `module-api-credentials.md`); `AuthService` talks to both exclusively via CQRS commands/queries (`@nestjs/cqrs`'s `CommandBus`/`QueryBus`), never by injecting their services directly. `CqrsModule.forRoot()` is registered once, globally, in `AppModule` — it's what makes `CommandBus`/`QueryBus` injectable here and discovers the `users`/`credentials` handlers app-wide, so this module doesn't import `CqrsModule` itself.

Changes here follow the Red/Green/Refactor TDD workflow in `apps/api/CLAUDE.md`: confirm `test/auth.e2e-spec.ts` (and unit specs) are green before refactoring, then re-run after each step.

## Architecture

- `AuthModule` (`auth.module.ts`) registers `JwtModule` asynchronously via `JwtModule.registerAsync`, pulling `secret` from `JWT_SECRET` (`config.getOrThrow`, so a missing secret fails startup loudly) and `signOptions.expiresIn` from `JWT_EXPIRES_IN` (default `'1h'`). Declares `AuthController` and `AuthService`.
- `AuthController` (`auth.controller.ts`) exposes `POST /auth/register` and `POST /auth/login`, both Swagger-annotated (`@ApiTags('auth')`, `@ApiOperation`, response decorators per status code). Pure pass-through to `AuthService` — no business logic in the controller.
- `AuthService` (`auth.service.ts`) orchestrates the two flows: issues a `FindUserByEmailQuery` (users module) and a `HashPasswordCommand`/`VerifyPasswordQuery` (credentials module) via `CommandBus`/`QueryBus`, then signs the JWT itself. It does **not** touch Prisma or bcrypt directly anymore.
- `dto/` — `RegisterDto`, `LoginDto`, `AuthResponseDto`, and a shared `normalizeEmail` `@Transform` in `transforms.ts`.
- Global `ThrottlerGuard` (set up in `AppModule`, not this module) applies a default 20 req/60s per IP to every route. `login` overrides that with a stricter `@Throttle({ default: { limit: 10, ttl: 60_000 } })` since it's the brute-force target.

## Hardening details (non-obvious, worth preserving)

- **Timing-safe login**: `login()` always issues a `VerifyPasswordQuery`, even when the email doesn't exist (passing `storedHash: null`). The query's handler (in `src/credentials`) falls back to a fixed dummy bcrypt hash in that case, so a lookup for an unregistered email costs the same wall-clock time as one for a registered email with a wrong password — response timing can't be used to enumerate valid accounts. See `module-api-credentials.md` for the handler-side details.
- **Registration race**: `register()` issues a `FindUserByEmailQuery` pre-check, but two concurrent registrations for the same email can both pass it. The real guard is the DB's unique constraint on `email`, enforced in `CreateUserHandler` (users module) — it catches `Prisma.PrismaClientKnownRequestError` with code `P2002` and rethrows as `ConflictException` (409). `AuthService` doesn't need to know this happened; it just propagates whatever the command throws.
- **bcrypt input cap**: both DTOs cap `password` at `MAX_PASSWORD_LENGTH = 72` — bcrypt only reads the first 72 bytes of its input, so anything longer is wasted (and, for unbounded input, DoS-able) hashing work. This validation stays in the DTOs (an input-boundary concern) even though the hashing itself moved to `src/credentials`.
- **Email normalization**: `normalizeEmail` (`transforms.ts`) trims and lowercases email input via `@Transform`, applied on both `RegisterDto.email` and `LoginDto.email`, so lookups/uniqueness checks aren't fooled by casing or whitespace.
- **Password complexity**: `RegisterDto.password` enforces ≥8 chars plus at least one uppercase, one lowercase, and one digit via `PASSWORD_COMPLEXITY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/`. `LoginDto.password` only checks non-empty + max length (login shouldn't reveal complexity rules).
- **Consent gate**: `RegisterDto.consentToTerms` uses `@Equals(true)` — registration hard-fails unless the caller explicitly sends `true`.

## Function reference

- `AuthController.register(dto: RegisterDto): Promise<AuthResponseDto>` — delegates to `authService.register(dto)`.
- `AuthController.login(dto: LoginDto): Promise<AuthResponseDto>` — delegates to `authService.login(dto)`; `@HttpCode(200)` since Nest defaults POST to 201.
- `AuthService.register(dto): Promise<AuthResponseDto>` — queries for an existing user by email (throws `ConflictException` if found), dispatches `HashPasswordCommand`, dispatches `CreateUserCommand` (propagates `ConflictException` from the handler on a uniqueness-race loss), returns a signed token.
- `AuthService.login(dto): Promise<AuthResponseDto>` — queries for the user by email, dispatches `VerifyPasswordQuery` with the user's hash (or `null`), returns a signed token. Throws `UnauthorizedException('Invalid email or password')` for either an unknown email or a wrong password (same message/status for both, by design).
- `AuthService.signToken(userId, email): Promise<string>` (private) — signs a JWT with payload `{ sub: userId, email }` via `jwtService.signAsync`.
- `normalizeEmail({ value }): unknown` (`dto/transforms.ts`) — trims + lowercases `value` if it's a string, otherwise passes it through unchanged (validation catches non-string values downstream).

## DTOs

- `RegisterDto` — `email` (validated + normalized, ≤254 chars), `password` (8–72 chars, complexity regex), `consentToTerms` (must be `true`).
- `LoginDto` — `email` (validated + normalized, ≤254 chars), `password` (non-empty, ≤72 chars, no complexity check).
- `AuthResponseDto` — `{ accessToken: string }`.
