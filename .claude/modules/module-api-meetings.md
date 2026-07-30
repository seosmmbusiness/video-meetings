# apps/api/src/meetings

Architecture and function reference for the meetings module: create/list/get, all scoped to the authenticated user and protected by a JWT guard added alongside this module.

Changes here follow the Red/Green/Refactor TDD workflow in `apps/api/CLAUDE.md`: confirm `test/meetings.e2e-spec.ts` (and unit specs) are green before refactoring, then re-run after each step.

## Architecture

- `MeetingsModule` (`meetings.module.ts`) imports `AuthModule` (for `JwtAuthGuard`), declares `MeetingsController` and `MeetingsService`. `PrismaService` isn't imported explicitly — `PrismaModule` is `@Global()`.
- `MeetingsController` (`meetings.controller.ts`) is guarded at the class level with `@UseGuards(JwtAuthGuard)`, so every route requires `Authorization: Bearer <token>`. Swagger-annotated (`@ApiTags('meetings')`, `@ApiBearerAuth()`, per-route `@ApiOperation`/response decorators). Pure pass-through to `MeetingsService`, reading the caller's id via the `@CurrentUser()` decorator.
- `MeetingsService` (`meetings.service.ts`) does the Prisma reads/writes, all scoped by `ownerId`.
- `dto/` — `CreateMeetingDto`, `MeetingResponseDto`.
- Prisma `Meeting` model (`prisma/schema.prisma`): `title`, optional `description`, `date`, `participants: String[]` (plain email strings, not a join to `User` — participants need not be registered users), `ownerId` (FK to `User`, `onDelete: Restrict`).

## Auth guard added alongside this module (lives in `src/auth`, not here)

Before this module, nothing verified JWTs — `AuthService` only signed them. To protect meetings routes, `src/auth` gained:

- `strategies/jwt.strategy.ts` — `JwtStrategy` (passport-jwt), extracts the bearer token, verifies against `JWT_SECRET`, and maps the payload (`{ sub, email }`) to `Request.user` as `{ userId, email }` (`AuthenticatedUser`).
- `guards/jwt-auth.guard.ts` — `JwtAuthGuard extends AuthGuard('jwt')`. Rejects with 401 on a missing/invalid/expired token.
- `decorators/current-user.decorator.ts` — `@CurrentUser()` param decorator, pulls `AuthenticatedUser` off the request.
- `AuthModule` now also imports `PassportModule` and registers `JwtStrategy` as a provider (see `.claude/modules/module-api-auth.md` if it needs updating for this — that doc's function reference is register/login-focused and wasn't rewritten here since register/login behavior itself didn't change).

## Access control (non-obvious, worth preserving)

- **List is owner-scoped, not global**: `GET /meetings` returns only meetings where `ownerId` matches the caller — there's no "all meetings" admin view.
- **404, not 403, for someone else's meeting**: `GET /meetings/:id` uses `findFirst({ where: { id, ownerId } })`, so a valid id owned by another user returns the same 404 as a nonexistent id. This mirrors the auth module's philosophy of not letting a response code reveal whether a resource exists — a caller can't distinguish "no such meeting" from "that meeting belongs to someone else."
- **Participants are unauthenticated emails**: `participants: string[]` on `CreateMeetingDto` is validated as an array of valid emails (`@IsEmail({}, { each: true })`, capped at `MAX_PARTICIPANTS = 100`) but isn't checked against the `User` table — inviting a non-registered email is allowed. There's no notification/invite flow yet, just storage.
- **Date validated as an ISO string, not `@IsDate`**: `date` uses `@IsDateString()` rather than `@Type(() => Date) @IsDate()`. `class-validator`'s `IsDate` only checks `instanceof Date`, which an `Invalid Date` (e.g. from `new Date('not-a-date')`) still satisfies — `IsDateString` (an `isISO8601` alias) actually rejects malformed strings. The service does `new Date(dto.date)` itself when writing to Prisma.

## Function reference

- `MeetingsController.create(user, dto): Promise<MeetingResponseDto>` — delegates to `meetingsService.create(user.userId, dto)`.
- `MeetingsController.findAll(user): Promise<MeetingResponseDto[]>` — delegates to `meetingsService.findAllForOwner(user.userId)`.
- `MeetingsController.findOne(user, id): Promise<MeetingResponseDto>` — delegates to `meetingsService.findOneForOwner(id, user.userId)`.
- `MeetingsService.create(ownerId, dto): Promise<MeetingResponseDto>` — inserts a meeting with `description` normalized to `null` when omitted.
- `MeetingsService.findAllForOwner(ownerId): Promise<MeetingResponseDto[]>` — `findMany` filtered by `ownerId`, newest first (`orderBy: { createdAt: 'desc' }`).
- `MeetingsService.findOneForOwner(id, ownerId): Promise<MeetingResponseDto>` — `findFirst` filtered by both `id` and `ownerId`; throws `NotFoundException('Meeting not found')` if nothing matches.
- `JwtStrategy.validate(payload): AuthenticatedUser` (`src/auth/strategies/jwt.strategy.ts`) — maps `{ sub, email }` to `{ userId, email }`.
- `CurrentUser` (`src/auth/decorators/current-user.decorator.ts`) — param decorator returning `request.user`.

## DTOs

- `CreateMeetingDto` — `title` (1–200 chars), `description` (optional, ≤2000 chars), `date` (ISO 8601 string), `participants` (array of emails, ≤100 entries).
- `MeetingResponseDto` — `{ id, title, description: string | null, date, participants, ownerId, createdAt, updatedAt }`.
