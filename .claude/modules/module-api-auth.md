# apps/api/src/auth

Architecture and function reference for email/password authentication: registration and login, both returning `{ accessToken: string }` (a JWT signed via `@nestjs/jwt`).

## Architecture

- `AuthModule` (`auth.module.ts`) registers `JwtModule` asynchronously via `JwtModule.registerAsync`, pulling `secret` from `JWT_SECRET` (`config.getOrThrow`, so a missing secret fails startup loudly) and `signOptions.expiresIn` from `JWT_EXPIRES_IN` (default `'1h'`). Declares `AuthController` and `AuthService`.
- `AuthController` (`auth.controller.ts`) exposes `POST /auth/register` and `POST /auth/login`, both Swagger-annotated (`@ApiTags('auth')`, `@ApiOperation`, response decorators per status code). Pure pass-through to `AuthService` — no business logic in the controller.
- `AuthService` (`auth.service.ts`) does the real work: password hashing/verification (bcrypt), Prisma lookups/writes, JWT signing.
- `dto/` — `RegisterDto`, `LoginDto`, `AuthResponseDto`, and a shared `normalizeEmail` `@Transform` in `transforms.ts`.
- Global `ThrottlerGuard` (set up in `AppModule`, not this module) applies a default 20 req/60s per IP to every route. `login` overrides that with a stricter `@Throttle({ default: { limit: 10, ttl: 60_000 } })` since it's the brute-force target.

## Hardening details (non-obvious, worth preserving)

- **Timing-safe login**: `login()` always calls `bcrypt.compare`, even when the email doesn't exist — against a fixed `DUMMY_PASSWORD_HASH` constant (a bcrypt hash of an unused password) when `user` is null. This means a lookup for an unregistered email costs the same wall-clock time as one for a registered email with a wrong password, so response timing can't be used to enumerate valid accounts.
- **Registration race**: `register()` does a `findUnique` pre-check, but two concurrent registrations for the same email can both pass it. The real guard is the DB's unique constraint on `email`; the `catch` block checks `error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'` and rethrows as `ConflictException` (409) instead of letting a raw 500 escape.
- **bcrypt input cap**: both DTOs cap `password` at `MAX_PASSWORD_LENGTH = 72` — bcrypt only reads the first 72 bytes of its input, so anything longer is wasted (and, for unbounded input, DoS-able) hashing work. Salt rounds are `BCRYPT_SALT_ROUNDS = 12`.
- **Email normalization**: `normalizeEmail` (`transforms.ts`) trims and lowercases email input via `@Transform`, applied on both `RegisterDto.email` and `LoginDto.email`, so lookups/uniqueness checks aren't fooled by casing or whitespace.
- **Password complexity**: `RegisterDto.password` enforces ≥8 chars plus at least one uppercase, one lowercase, and one digit via `PASSWORD_COMPLEXITY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/`. `LoginDto.password` only checks non-empty + max length (login shouldn't reveal complexity rules).
- **Consent gate**: `RegisterDto.consentToTerms` uses `@Equals(true)` — registration hard-fails unless the caller explicitly sends `true`.

## Function reference

- `AuthController.register(dto: RegisterDto): Promise<AuthResponseDto>` — delegates to `authService.register(dto)`.
- `AuthController.login(dto: LoginDto): Promise<AuthResponseDto>` — delegates to `authService.login(dto)`; `@HttpCode(200)` since Nest defaults POST to 201.
- `AuthService.register(dto): Promise<AuthResponseDto>` — checks for an existing user by email, hashes the password, inserts the user, returns a signed token. Throws `ConflictException` if the email is already registered (either from the pre-check or the DB unique-constraint race).
- `AuthService.login(dto): Promise<AuthResponseDto>` — looks up the user by email, timing-safe-compares the password (see Hardening above), returns a signed token. Throws `UnauthorizedException('Invalid email or password')` for either an unknown email or a wrong password (same message/status for both, by design).
- `AuthService.signToken(userId, email): Promise<string>` (private) — signs a JWT with payload `{ sub: userId, email }` via `jwtService.signAsync`.
- `normalizeEmail({ value }): unknown` (`dto/transforms.ts`) — trims + lowercases `value` if it's a string, otherwise passes it through unchanged (validation catches non-string values downstream).

## DTOs

- `RegisterDto` — `email` (validated + normalized, ≤254 chars), `password` (8–72 chars, complexity regex), `consentToTerms` (must be `true`).
- `LoginDto` — `email` (validated + normalized, ≤254 chars), `password` (non-empty, ≤72 chars, no complexity check).
- `AuthResponseDto` — `{ accessToken: string }`.
