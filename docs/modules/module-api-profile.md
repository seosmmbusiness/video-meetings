# apps/api/src/profile

Owns the signed-in caller's **own** self-service routes: `GET /profile` and `PATCH /profile`.

It is a module of its own rather than a controller inside `src/users` or `src/auth` (D-1). `src/users` states it has no HTTP surface and exposes persistence only over CQRS, and a display name is not authentication — folding these routes into `src/auth` would give the module every guard depends on a third, unrelated concern.

Its shape is the one `src/auth` already uses: a controller plus a service over the CQRS buses, and **no Prisma of its own**. It reaches the `User` row through two users-module handlers — `FindUserByIdQuery` and `UpdateUserNameCommand` (D-3, see `module-api-users.md`).

Two invariants hold everywhere in this module:

- **The subject is the token, never the payload.** Neither route takes a path segment or a body field naming an account, so there is nothing to point at somebody else's row (AC-15). There is deliberately no `GET /profile/:id`.
- **The response is built field by field, never spread from the entity.** `passwordHash`, `tokenVersion`, `avatarKey`, `avatarMimeType` and `avatarSize` stay off the wire because `toResponse` names the five fields it copies (S-1, AC-18).

## Architecture

- `ProfileModule` (`profile.module.ts`) — imports `AuthModule` for `JwtAuthGuard`; declares `ProfileController` and `ProfileService`. Registered in `AppModule`, which also provides the app-wide `CqrsModule.forRoot()` the service dispatches on.
- `profile.controller.ts` — `@UseGuards(JwtAuthGuard)` on the whole controller; both routes take their subject from `@CurrentUser()` and delegate straight to the service. Fully annotated for Swagger (`@ApiTags('profile')`, `@ApiBearerAuth()`, 200/400/401/404).
- `profile.service.ts` — the read/update logic, over `QueryBus`/`CommandBus`.
- `dto/profile-response.dto.ts` — `ProfileResponseDto`, the five keys a profile answer carries.
- `dto/update-profile.dto.ts` — `UpdateProfileDto` plus the exported `normalizeName` transform.
- `profile.constants.ts` — `MAX_NAME_LENGTH` (80) and `MAX_NAME_LENGTH_MESSAGE`, shared by the DTO and its specs so the limit is stated once.

## Function reference

- `ProfileController.getProfile(user: AuthenticatedUser): Promise<ProfileResponseDto>` — `GET /profile`; passes `user.userId` to the service.
- `ProfileController.updateProfile(user: AuthenticatedUser, dto: UpdateProfileDto): Promise<ProfileResponseDto>` — `PATCH /profile`; the body is already validated and normalised by the global `ValidationPipe` (`whitelist` strips unknown fields, so an update cannot mass-assign).
- `ProfileService.getProfile(userId: string): Promise<ProfileResponseDto>` — dispatches `FindUserByIdQuery`; throws `NotFoundException('Profile not found')` when the row is gone, then maps through `toResponse`.
- `ProfileService.updateProfile(userId: string, dto: UpdateProfileDto): Promise<ProfileResponseDto>` — a payload with **no** `name` key at all changes nothing and falls through to `getProfile`; an explicitly submitted value (including `''`) is written via `UpdateUserNameCommand`.
- `ProfileService.toResponse(user: User): ProfileResponseDto` (private) — the field-by-field mapping. `hasAvatar` is **derived** (`user.avatarKey !== null`), not stored; phase 3 is what starts filling the avatar columns, so today every row answers `false`/`null`.
- `normalizeName({ value }): unknown` (`dto/update-profile.dto.ts`) — the `@Transform` callback: strips C0 control characters and DEL, strips the bidirectional overrides/embeddings/isolates (`U+202A`–`U+202E`, `U+2066`–`U+2069`), then trims. Non-string values pass through untouched so `@IsString` still owns the type error.

## DTO reference

- `ProfileResponseDto` — `id`, `email`, `name: string | null`, `hasAvatar: boolean`, `avatarUpdatedAt: Date | null`. The field set is final from phase 1 on: the two avatar fields are carried now and filled in phase 3, so the web client's shape does not change under it.
- `UpdateProfileDto` — one optional field, `name`, in this order: `@Transform(normalizeName)` → `@IsOptional()` → `@IsString()` → `@MaxLength(80)`.

## Gotchas

- **Normalise, never reject.** A name carrying a NUL byte or a bidi override is cleaned and accepted, matching what `FilesService` already does to an uploaded filename (S-2). Postgres cannot store a NUL in a text column, so rejecting late would have answered 500 instead of the stated behaviour.
- **Stripping runs before the length check.** Removed bytes never count against the 80-character limit, which is why the `@Transform` has to sit above the validators.
- **`U+200E`/`U+200F` survive on purpose.** The plain left-to-right/right-to-left marks are how a legitimate Hebrew or Arabic name sets its direction; only the _overriding_ controls go.
- **Missing `name` ≠ empty `name`.** Absent leaves the stored value alone; `''` clears it to `NULL` (AC-4). Both answer 200 with the current profile.
- **An access token outlives its row** — it stays valid for up to an hour after the account goes. Both paths answer the same 404: the read because the query resolves to `null`, the write because `UpdateUserNameHandler` translates Prisma's `P2025`.
- **80 is the column, not just the DTO.** `User.name` is `@db.VarChar(80)` (D-2); the DTO's limit mirrors it rather than replacing it.

## Tests

| Tier        | File                                                                                      | Covers                                                                                                                                                                                                                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | `profile.controller.spec.ts`, `profile.service.spec.ts`, `dto/update-profile.dto.spec.ts` | Delegation from the token's subject, the absent-vs-empty `name` split, the 404 paths, and every normalisation/limit case on the DTO.                                                                                                                                                        |
| Integration | `profile.int-spec.ts`                                                                     | The real buses against Postgres: the five-key mapping, the write-then-read round trip, `''` → `NULL`, one account never touching another's row, and the hash staying out of the response.                                                                                                   |
| E2E         | `../../test/profile.e2e-spec.ts`                                                          | Both routes over HTTP: missing/invalid/expired token, the exact five keys, an 80-character name stored trimmed, 81 refused with the limit named and nothing written, clearing, NUL sanitised, unknown field not assigned, no `/profile/:id`, and a second account's token reaching nothing. |
