# Final plan: User profile

**Key**: UP
**PRD**: [user-profile-PRD.md](./user-profile-PRD.md)
**Plan**: [user-profile-PLAN.md](./user-profile-PLAN.md)
**Research**: [user-profile-RESEARCH.md](./user-profile-RESEARCH.md)
**Threats**: [user-profile-THREATS.md](./user-profile-THREATS.md)
**Date**: 2026-08-17
**Status**: ready for /bldprj:issues

## What ships

A signed-in user gets `/profile`: their email, a name they can set or clear (up to 80 characters), an
avatar they can upload, replace or remove (PNG, JPEG or WebP, up to 5 MB), and a password they can
change by typing the current one. The name and the avatar then appear on the dashboard next to them;
with no name set, the email stays. Changing the password ends every other session of that account on
its next request while the session that made the change carries on.

Nothing is installed — multer, `file-type` and HeroUI's `Avatar` are already here. Six phases,
alternating API then web, one capability at a time. Two rulings changed what was written before:
the avatar is served with a **60-second private browser cache** instead of `no-store` (T-1), which
trades a sliver of AC-9 for not re-downloading up to 5 MB on every page render; and AC-1's "no state
that flips" is read as the project's no-flash rule about session state, not as a ban on an image
painting after its markup (T-2).

Out of this iteration, unchanged from the PRD: changing an email, resetting a forgotten password,
deleting an account, collecting a name at registration, showing anyone's avatar to anyone else,
cropping or resizing, animated avatars, avatar history, a shareable avatar URL, a device list and
two-factor authentication.

## Trace

| AC    | Phase   | Tasks              | Decisions     | Findings | Proven by                                                                                         |
| ----- | ------- | ------------------ | ------------- | -------- | ------------------------------------------------------------------------------------------------- |
| AC-1  | 2, 4    | 2.3, 2.5, 4.5      | D-5, D-13     | —        | `apps/web/e2e/profile.spec.ts` — first server response carries email, name and the avatar mark    |
| AC-2  | 1, 2    | 1.4, 1.5, 2.2, 2.4 | D-1, D-2, D-3 | S-1      | `apps/api/test/profile.e2e-spec.ts` — 80-char name stored trimmed; `profile.spec.ts` after reload |
| AC-3  | 1, 2    | 1.4, 1.5, 2.4      | D-2           | S-2      | `profile.e2e-spec.ts` — 81 chars → `400` naming the 80-character limit, stored value unchanged    |
| AC-4  | 1, 2    | 1.4, 1.5, 2.4, 2.5 | D-2           | —        | `profile.e2e-spec.ts` — empty submission clears; `profile.spec.ts` — `/` shows the email again    |
| AC-5  | 2, 4    | 2.5, 4.5           | D-5, D-13     | —        | `apps/web/e2e/home.spec.ts` — name when set, email when not, in the server-rendered HTML          |
| AC-6  | 3, 4    | 3.3, 3.4, 4.3, 4.5 | D-4, D-6, D-7 | S-5      | `profile.e2e-spec.ts` — replace returns `200`; `profile.int-spec.ts` — the old key's bytes gone   |
| AC-7  | 3, 4    | 3.4, 4.3           | D-6           | —        | `profile.e2e-spec.ts` — 5 MB + 1 byte → `413`, avatar unchanged, nothing stored                   |
| AC-8  | 3, 4    | 3.4, 4.3           | D-6           | —        | `profile.e2e-spec.ts` — a PDF renamed `.png` → `415` naming png, jpg, webp                        |
| AC-9  | 3, 4    | 3.5, 4.4, 4.5      | D-7, D-8      | S-5      | `profile.e2e-spec.ts` — after `DELETE`, `GET /profile/avatar` → `404`; page shows the fallback    |
| AC-10 | 5, 6    | 5.2, 5.3, 6.2      | D-11          | S-4      | `profile.e2e-spec.ts` — new password logs in, old one → `401` at `/auth/login`                    |
| AC-11 | 5, 6    | 5.2, 6.2           | D-11          | S-4      | `profile.e2e-spec.ts` — wrong current password → `403`, hash unchanged, `ver` not incremented     |
| AC-12 | 5, 6    | 5.3, 6.2           | D-11          | —        | `change-password.dto.spec.ts` per rule; `profile.spec.ts` — mismatch refused server-side          |
| AC-13 | 5, 6    | 5.4, 5.5, 6.3, 6.4 | D-9, D-10     | —        | `profile.e2e-spec.ts` — pre-change token → `401`, changer's token still `200`; two contexts e2e   |
| AC-14 | 2, 6    | 2.3, 6.4           | D-11          | —        | `apps/web/e2e/profile.spec.ts` — no cookie and tampered cookie both land on `/login`              |
| AC-15 | 1, 3, 5 | 1.5, 3.5, 5.2      | D-1, D-3      | S-1      | `profile.e2e-spec.ts` — B's token never reaches A's name, avatar bytes or password                |
| AC-16 | 2       | 2.3, 2.5           | D-13          | S-2      | `apps/web/e2e/profile.spec.ts` — a name of markup renders as text and executes nothing            |
| AC-17 | 2, 4, 6 | 2.3, 4.2, 6.3      | D-12          | S-6      | `profile.spec.ts` — no JWT in HTML or bundle; `profile.int-spec.ts` — none in the action's state  |
| AC-18 | 1, 3, 5 | 1.5, 3.2, 3.5, 5.5 | D-3, D-5, D-9 | S-1      | `profile.e2e-spec.ts` — `Object.keys(body)` equals the fixed set on every profile route           |
| AC-19 | 2, 6    | 2.4, 6.2           | D-12          | S-3      | `actions/profile.int-spec.ts` — action with no cookie makes no upstream `fetch`                   |
| AC-20 | 5       | 5.2                | D-11          | S-4      | `profile.e2e-spec.ts` — the 11th attempt inside 60 s answers `429`                                |

Doc tasks (1.6, 2.6, 3.6, 4.6, 6.5) trace to the project's own documentation convention (root
`CLAUDE.md`, "Docs move with the code" and Module documentation), not to an `AC-<n>` — by design in
this pipeline, which forbids a trailing documentation phase.

## Phase 1. Account name in the API

**Goal**: an account can hold a name, and the signed-in caller can read and change their own — and
only their own.
**Touches**: api · database
**Covers**: AC-2, AC-3, AC-4, AC-15, AC-18
**Decisions**: D-1, D-2, D-3
**Threats**: S-1, S-2
**Verified by**: Red/Green/Refactor per `apps/api/CLAUDE.md`'s Development workflow — the e2e cases
are written and reviewed with the requester first and land red in their own `test(api): …` commit,
then each unit gets its `*.spec.ts` (or `*.int-spec.ts`, if it needs Postgres) red before the code
that greens it. "Security test cases are mandatory, not optional": authorization boundaries (IDOR),
auth bypass on a protected route, and mass-assignment rejection by `ValidationPipe`'s `whitelist`,
each at the tier that proves it. E2e cases go in `apps/api/test/profile.e2e-spec.ts`, unit specs
beside their source under `src/profile/`, integration under `src/profile/profile.int-spec.ts`.
Suites: `npm run test:api`, `npm run test:int:api`, `npm run test:e2e:api` (the last two need
`npm run db:up`).
**Status**: complete — 2026-08-18, branch feature/user-profile-phase-1, PR https://github.com/seosmmbusiness/video-meetings/pull/174
**Tasks**:

- [x] **1.1** Cover reading and updating the caller's own name — tests: `apps/api/test/profile.e2e-spec.ts`
      for AC-2, AC-3, AC-4 and AC-15 (B's token reaches nothing of A's; no path segment or body field
      is accepted as the subject), and `src/profile/dto/update-profile.dto.spec.ts` for trim, the
      80-character bound, mass-assignment rejection, and the **Name normalisation** transform — one
      case per class: a NUL byte, a `U+007F`, a `U+202E` override, and a `U+200F` mark that must
      **survive** (S-2). AC-18's case asserts `Object.keys(body).sort()` equals
      `['avatarUpdatedAt','email','hasAvatar','id','name']` exactly, not merely that `passwordHash`
      is absent (S-1). Red, committed on its own, before 1.2 starts.
- [x] **1.2** Give an account a name it can store — one Prisma migration named `add_user_profile`
      adds every column this feature needs, so the schema moves once: `name String? @db.VarChar(80)`
      (D-2), the four avatar columns phase 3 fills — `avatarKey String? @unique`,
      `avatarMimeType String? @db.VarChar(64)`, `avatarSize Int?`, `avatarUpdatedAt DateTime?` (D-5)
      — and `tokenVersion Int @default(0)` for phase 5 (D-9). Every already-registered row keeps
      `NULL` in each nullable column and `0` in `tokenVersion`. `npm run prisma:migrate:dev`.
- [x] **1.3** Read the caller's own profile — `FindUserByIdQuery(userId)` returns the full Prisma
      `User` row through the users module's CQRS surface, exactly as `FindUserByEmailQuery` does
      (D-3); `UsersModule` still exports no providers. The full row is deliberate: `JwtStrategy`
      reads `tokenVersion` off this same query in 5.4, which is why the response mapping in 1.5 —
      not this query — is the boundary that keeps the hash off the wire (S-1).
- [x] **1.4** Update the caller's own name — `UpdateUserNameCommand(userId, name)` stores the value
      the DTO produced; `UpdateProfileDto.name` is `@IsOptional()` and runs its `@Transform` in this
      order, from the research's **Name normalisation** row: strip `U+0000`–`U+001F` and `U+007F`,
      then `U+202A`–`U+202E` and `U+2066`–`U+2069`, **keeping** `U+200E`/`U+200F`; then trim; then
      `@MaxLength(80)` with the message `Name must be 80 characters or fewer.` An empty result is
      stored as `NULL`, which is how a name is cleared (AC-4). Normalise, never reject — the rule
      `FilesService` already applies to an uploaded file's name — so a NUL cannot reach Postgres and
      answer `500` (S-2).
- [x] **1.5** Expose both behind the JWT guard — a new `src/profile` module (D-1):
      `ProfileController` under `@UseGuards(JwtAuthGuard)`, exposing `GET /profile` and
      `PATCH /profile`, resolving the subject from `@CurrentUser()` alone — never a path segment or a
      body field, so there is nothing to point at another account (AC-15). Both answer
      `ProfileResponseDto` built field by field — never the Prisma row, never a spread — carrying
      exactly `{ id, email, name, hasAvatar, avatarUpdatedAt }` (S-1, AC-18). **The full field set
      ships in this phase**: `hasAvatar` is `false` and `avatarUpdatedAt` is `null` until phase 3
      fills them, so phase 2 can render against the final shape and the AC-18 assertions in 1.1 and
      3.1 agree. Swagger-annotated per `apps/api/CLAUDE.md`.
- [x] **1.6** Document the profile and users modules — a new
      `docs/modules/module-api-profile.md` (D-1: the module's shape, the subject-from-token rule,
      the DTO boundary), `module-api-users.md` extended with the new commands/queries, both rowed in
      `docs/modules/INDEX.md` with a pointer in `apps/api/CLAUDE.md`; JSDoc on every function
      added; the entry in `apps/api/HISTORY.md`.

**Done when**: `npm run test:api`, `npm run test:int:api` and `npm run test:e2e:api` are green, and
`profile.e2e-spec.ts` shows: `GET /profile` returning `200` with exactly the five keys; an
80-character name stored trimmed; 81 characters answering `400` with the limit named and the stored
value unchanged; an empty submission clearing it; and account B's token answering nothing of A's.

## Phase 2. Profile page and the name on the dashboard

**Goal**: the user has a page showing their email and name, can change the name there, and the
dashboard greets them by it instead of by their email address.
**Touches**: web
**Covers**: AC-1, AC-2, AC-3, AC-4, AC-5, AC-14, AC-16, AC-17, AC-19
**Decisions**: D-5, D-12, D-13
**Threats**: S-3
**Verified by**: "Tests come before the code, at every tier that applies — not e2e alone"
(`apps/web/CLAUDE.md`, Development workflow): Vitest + RTL for `src/lib` and Client Components,
Server Actions called directly as `*.int-spec.ts(x)`, Playwright for the page, its auth gate and its
redirects — an async Server Component cannot be rendered by Vitest/RTL, so its rendering and its
gate are e2e's job. Security cases are mandatory: safe rendering of user-controlled input, the
protected page against a missing or tampered session, and the absence of the token from the page
source and client bundle. Cases go in `apps/web/e2e/profile.spec.ts`,
`src/app/actions/profile.int-spec.ts` and `src/lib/profile-api.spec.ts`. After building the UI,
review it with `web-design-guidelines` then `ui-ux-pro-max`, and verify visually with the Playwright
MCP tools against a running dev server, saving shots under `screenshots/`. Suites:
`npm run test:web`, `npm run test:e2e:web` (needs `apps/api` + Postgres up).
**Status**: complete — 2026-08-20, branch feature/user-profile-phase-2, PR https://github.com/seosmmbusiness/video-meetings/pull/178

**Tasks**:

- [x] **2.1** Cover the profile page and the dashboard's name — tests: `apps/web/e2e/profile.spec.ts`
      for AC-1 (email, name and the avatar mark present in the first server response), AC-14 (no
      cookie and a tampered cookie both land on `/login` with no profile data in the body), AC-16 (a
      name of markup renders as text) and AC-17 (no JWT in the HTML or the client bundle);
      `apps/web/e2e/home.spec.ts` extended for AC-5; `src/app/actions/profile.int-spec.ts` for
      AC-19 — the action invoked with `next/headers` mocked to no cookie makes no upstream `fetch`
      (S-3); `src/lib/profile-api.spec.ts` for the client's `ApiError` shaping. Red before 2.2.
- [x] **2.2** Read the caller's profile server-side — `src/lib/profile-api.ts`, `import 'server-only'`,
      calling phase 1's `GET`/`PATCH /profile` against `API_BASE_URL` with the bearer token and
      `cache: 'no-store'`, throwing `ApiError` on a non-2xx exactly as `meetings-api.ts` does. It
      keeps `401` (session gone) and `403` (refused, stay put) distinguishable for 6.4 (D-11).
- [x] **2.3** Ship the profile page — `src/app/profile/page.tsx`, an async Server Component:
      `getSession()` first, `redirect('/login')` before any JSX when there is no session or the API
      answers `401` (AC-14), then email, name and the avatar mark rendered in the first response
      (AC-1). Until phase 4 there is no image to fetch, so it renders HeroUI's `Avatar.Fallback`
      from the name's initials, else the email's first letter (D-13). Reachable from the dashboard
      by a link beside the existing sign-out control.
- [x] **2.4** Change the name from the page — `src/app/actions/profile.ts`'s `updateNameAction`,
      bound through `useActionState`, submitting the name (D-12: fields go through actions, only
      bytes need a route), re-rendering with the stored value on success via `revalidatePath` and
      showing the API's refusal verbatim on failure (AC-2, AC-3, AC-4); any client-side hint mirrors
      the API's rules rather than replacing them. `getSession()` is its **first statement** and it
      returns the signed-out outcome without calling `apps/api` — a Server Action is reachable by
      direct POST, not only through the form (S-3, AC-19) — exactly as `actions/files.ts` guards.
- [x] **2.5** Greet the user by name on the dashboard — `src/app/page.tsx` shows the name when one is
      set and the email when not, in the server-rendered HTML, with no client-side read after mount
      (AC-5). Both are rendered as text; React's escaping is what keeps AC-16.
- [x] **2.6** Document the web profile module — a new `docs/modules/module-web-profile.md` per the
      root `CLAUDE.md`'s Module documentation section, its row in `docs/modules/INDEX.md`, the
      one-line pointer plus Status line in `apps/web/CLAUDE.md`, JSDoc on every function added, and
      the entry in `apps/web/HISTORY.md`.

**Done when**: `npm run test:web` and `npm run test:e2e:web` are green; a signed-in user sets a name
on `/profile` and sees it on `/` after a hard refresh with no flash of the email first; a signed-out
visitor asking for `/profile` lands on `/login` with no profile data in the response; a name of
markup renders as text; and the two UI review passes have run.

## Phase 3. Avatar upload and serving in the API

**Goal**: an account can hold one avatar image — its owner uploads, replaces, fetches and removes
it, and nobody else can fetch it.
**Touches**: api · database · storage
**Covers**: AC-6, AC-7, AC-8, AC-9, AC-15, AC-18
**Decisions**: D-1, D-3, D-4, D-5, D-6, D-7, D-8
**Threats**: S-1, S-5
**Verified by**: same as phase 1 — Red/Green/Refactor per `apps/api/CLAUDE.md`, e2e cases red and
committed first, unit/integration inner loop after, mandatory security cases (IDOR on the bytes,
auth bypass, refusal of a file whose content contradicts its name). D-4 moves working
meeting-files code, so this phase is also held to the refactor rule in the same document — "before
starting any refactor, run all three suites first and confirm they're fully green on the current
code", then re-run after each step, and stop and fix immediately if a step turns one red. Cases go
in `apps/api/test/profile.e2e-spec.ts` and `src/profile/profile.int-spec.ts`; the moved code keeps
its existing specs, relocated with it. Suites: `npm run test:api`, `npm run test:int:api`,
`npm run test:e2e:api`.
**Status**: complete — 2026-08-21, branch feature/user-profile-phase-3, PR https://github.com/seosmmbusiness/video-meetings/pull/181

**Tasks**:

- [x] **3.1** Cover avatar upload, serving and removal — tests: `profile.e2e-spec.ts` for AC-6
      (upload `201`, replace `200`), AC-7 (5 MB + 1 byte → `413` naming the 5 MB limit), AC-8 (a PDF
      renamed `.png` → `415` naming `png, jpg, webp`), AC-9 (`DELETE` then `GET` → `404`) and AC-15
      (B's token → `404`, never bytes); AC-18's key-set assertion on the avatar routes' JSON (S-1);
      and `profile.int-spec.ts` proving the replaced key's bytes are gone from `FileStorage` (S-5).
      Red before 3.2 starts.
- [x] **3.2** Fill the avatar's columns and DTO — the four columns from 1.2's migration
      (`avatarKey`, `avatarMimeType`, `avatarSize`, `avatarUpdatedAt`) are written and cleared as one
      group (D-5); `ProfileResponseDto` now computes `hasAvatar` from `avatarKey != null` and exposes
      `avatarUpdatedAt`, and still never carries the key, a path, the hash or `tokenVersion` (S-1,
      AC-18).
- [x] **3.3** Store and replace one avatar per account — first lift the boundary: `file-storage.ts`,
      `local-disk-file-storage.ts` and `storage-root.ts` move from `src/files/storage/` into a new
      `src/storage` module that exports `FileStorage` (bound to `LocalDiskFileStorage`), which is
      what makes it reachable from `profile` without importing the meeting-files feature (D-4).
      `resolveStorageRoot()` stays a lazy `process.env` read — it runs at controller-decoration time,
      before `.env` loads — and the `0o700`/`0o600` modes come across unchanged; the files suites are
      the proof. Then the commit order (D-7): `FileStorage.save('users/<userId>/avatar/<uuid>', tmp)`
      → `UpdateUserAvatarCommand` writes the four columns → the **previous** key's bytes are deleted
      best-effort, failures logged as a count and never as a key. A fresh UUID per upload is what
      makes a replacement atomic from the reader's side (AC-6).
- [x] **3.4** Refuse anything but a 5 MB PNG, JPEG or WebP — `FileTypeService` moves into
      `src/storage` beside the boundary and takes its accepted-MIME set as a parameter, so `files`
      passes its twelve and `profile` passes `{ png: image/png, jpg: image/jpeg, webp: image/webp }`
      (D-4). Three gates in order (D-6): `AvatarSizeGuard` refuses a declared `Content-Length` over
      `MAX_AVATAR_BYTES = 5_242_880` at zero bytes read and arms a 60 000 ms inactivity timeout;
      multer's own `limits.fileSize` catches a chunked body, with a filter mapping `LIMIT_FILE_SIZE`
      to the same `413`; then content detection answers `415` before any row exists. Messages
      verbatim: `Avatar exceeds the 5 MB limit.` and
      `Unsupported image type. Accepted types: png, jpg, webp.` A refusal leaves the current avatar
      and the stored bytes untouched and unlinks the temp file (AC-7, AC-8).
- [x] **3.5** Serve and remove the owner's avatar — `GET /profile/avatar` resolves the key from the
      caller's own row and sends the bytes with `Content-Type` from `avatarMimeType`,
      `Content-Disposition: inline`, `X-Content-Type-Options: nosniff` and **`Cache-Control: private,
max-age=60`** (T-1 — the 60 seconds is this document's number, not the research's `no-store`),
      splitting the resolved path into `root` + basename so `send`'s `dotfiles` check never sees
      `STORAGE_ROOT`'s `.data` segment (D-8); `404` when there is no avatar.
      `DELETE /profile/avatar` clears the four columns first, then deletes the bytes, and answers the
      same DTO (AC-9, AC-15, S-1). Throttles: `{ limit: 240, ttl: 60_000 }` on the read,
      `{ limit: 30, ttl: 60_000 }` on write and delete.
- [x] **3.6** Document the storage and profile modules — a new
      `docs/modules/module-api-storage.md` for the extracted module (the boundary, the modes, the
      lazy `resolveStorageRoot()` gotcha, the parameterised type detection),
      `module-api-files.md` pointing at it instead of describing it, `module-api-profile.md` gaining
      the avatar routes and the commit order, rows in `docs/modules/INDEX.md` and
      `apps/api/CLAUDE.md`, Swagger for the new routes (`@ApiConsumes`, one `@Api*Response` per
      refusal status), JSDoc, and the entry in `apps/api/HISTORY.md`.

**Done when**: the three api suites are green — **including every meeting-files spec, unchanged in
behaviour after D-4's move** — and `profile.e2e-spec.ts` shows an upload (`201`), a replacement
(`200`, old bytes gone), a removal (`204`/`200` then `404` on the read), a 5 MB-plus refusal
(`413`), a renamed-non-image refusal (`415`), and account B's token answering `404` rather than
bytes.

## Phase 4. Avatar in the profile and on the dashboard

**Goal**: the user uploads, replaces and removes their avatar in the browser and sees it on both
pages, without the session token ever reaching the browser.
**Touches**: web
**Covers**: AC-1, AC-5, AC-6, AC-7, AC-8, AC-9, AC-17
**Decisions**: D-8, D-12, D-13
**Threats**: —
**Verified by**: same as phase 2 — tests before the code at every tier: the byte proxy as a Route
Handler `*.int-spec.ts` called directly (the tier `apps/web/CLAUDE.md` names for "the proxy's
request/response header allow-list, the bearer token being attached server-side while the caller's
own `Authorization` is dropped, the pre-upstream `401`"), the upload control through Vitest + RTL
driven with `@testing-library/user-event` and queried by role or label, the two pages through
Playwright. Cases go in `src/app/api/profile/avatar/route.int-spec.ts`,
`src/components/profile/avatar-uploader.spec.tsx` and `apps/web/e2e/profile.spec.ts`. UI reviewed
with `web-design-guidelines` then `ui-ux-pro-max`, verified visually with the Playwright MCP tools.
Suites: `npm run test:web`, `npm run test:e2e:web`.
**Status**: complete — 2026-08-21, branch feature/user-profile-phase-4, PR https://github.com/seosmmbusiness/video-meetings/pull/183

**Tasks**:

- [x] **4.1** Cover the avatar UI and its byte proxy — tests: `route.int-spec.ts` for the header
      allow-list, the server-side token attachment, the dropped caller `Authorization` and the
      pre-upstream `401`; `avatar-uploader.spec.tsx` for the browser-side size and declared-type
      refusals; `apps/web/e2e/profile.spec.ts` for AC-6, AC-7, AC-8, AC-9 and AC-17 through the page.
      Red before 4.2 starts.
- [x] **4.2** Proxy the avatar bytes same-origin — `src/app/api/profile/avatar/route.ts` exporting
      `GET`, `POST` and `DELETE`, each calling `getSession()` and answering `401` with no body before
      any upstream call, then `proxyToApi(request, session.token, '/profile/avatar')` — a fixed path
      with no caller-controlled segment (AC-17, D-12). A Server Action cannot carry these bytes: Next
      caps an action's request body at 1 MB by default, against a 5 MB avatar.
- [x] **4.3** Upload and replace the avatar in the browser — a Client Component on `/profile` that
      refuses a file over 5 MB or outside `image/png`, `image/jpeg`, `image/webp` **by its declared
      type and size, before sending** — a convenience check, not the boundary; the API's
      content-based refusal (3.4) is surfaced verbatim when a file gets past it (AC-6, AC-7, AC-8).
      On success it calls `router.refresh()` so the server tree re-renders with the new
      `avatarUpdatedAt`, which changes the image URL and defeats T-1's 60-second cache.
- [x] **4.4** Remove the avatar from the profile page — a control issuing `DELETE` through the proxy
      and then `router.refresh()`, returning both pages to the fallback (AC-9).
- [x] **4.5** Show the avatar next to the user on both pages — `src/components/profile/user-avatar.tsx`
      renders HeroUI's `Avatar.Image` when `hasAvatar` and `Avatar.Fallback` when not, in the first
      server response rather than after mount (AC-1, AC-5), at a fixed rendered size so nothing
      shifts. `src` is `/api/profile/avatar?v=<avatarUpdatedAt epoch ms>`; `next/image` is not used —
      `/_next/image` fetches its source server-side without the session cookie and would `401`
      (D-13). Per T-2, the fallback showing while the image loads is an image load, not a state flip.
- [x] **4.6** Document the avatar UI and the proxy — `docs/modules/module-web-profile.md` gains
      the uploader, the proxy route and the `?v=` cache-busting rule, `apps/web/CLAUDE.md`'s
      Structure and Status lines follow, JSDoc on every function added, entry in
      `apps/web/HISTORY.md`.

**Done when**: `npm run test:web` and `npm run test:e2e:web` are green; a user uploads an avatar and
sees it on `/profile` and on `/` without a manual reload, is refused an oversized and a wrong-type
file with the reason on screen, and removes it back to the fallback; and the two UI review passes
have run.

## Phase 5. Password change and session revocation

**Goal**: the owner changes their password by proving the current one, and every other session of
that account stops working the moment they do.
**Touches**: api · database
**Covers**: AC-10, AC-11, AC-12, AC-13, AC-15, AC-18, AC-20
**Decisions**: D-1, D-3, D-9, D-10, D-11
**Threats**: S-1, S-4
**Verified by**: same as phase 1, with the rate-limiting/brute-force class of `apps/api/CLAUDE.md`'s
mandatory security cases applying here as it does to login — the current-password check is a
credential check on a route a signed-in caller can hammer. E2e proves the revocation through real
HTTP with two tokens (`apps/api/test/profile.e2e-spec.ts`); the guard's own decision is a unit spec
(`src/auth/strategies/jwt.strategy.spec.ts`). Suites: `npm run test:api`, `npm run test:int:api`,
`npm run test:e2e:api`.
**Status**: complete — 2026-08-23, branch feature/user-profile-phase-5, PR https://github.com/seosmmbusiness/video-meetings/pull/185
**Tasks**:

- [x] **5.1** Cover the password change and session revocation — tests: `profile.e2e-spec.ts` for
      AC-10 (new password logs in, old one `401`s at `/auth/login`), AC-11 (wrong current password
      → `403`, nothing changed, no session ended), AC-12 (each broken rule named), AC-13 (a token
      minted before the change → `401` after it, while the token the change returned still works)
      and AC-15; AC-20's case fires 11 wrong-current-password attempts inside 60 s and asserts the
      11th is `429` (S-4); AC-18's asserts the body is exactly `{ accessToken }` (S-1);
      `jwt.strategy.spec.ts` covers the `ver` comparison including a token with no `ver` claim. Red
      before 5.2 starts.
- [x] **5.2** Change the password behind the current one — `PATCH /profile/password` takes
      `{ currentPassword, newPassword }`, verifies the current one through `VerifyPasswordQuery`'s
      timing-safe path, hashes the new one with `HashPasswordCommand`, and answers **`403`** with
      `Current password is incorrect.` when it is wrong — never `401`, because `apps/web` reads 401
      as "signed out" and D-9 makes 401 the revoked-token answer (D-11) — changing nothing and
      ending no session (AC-10, AC-11). The route carries
      `@Throttle({ default: { limit: 10, ttl: 60_000 } })`, the same override `/auth/login` has: it
      answers whether a supplied password is the account's, so it is a password oracle behind one
      stolen session (S-4, AC-20).
- [x] **5.3** Hold the new password to the registration rules — `ChangePasswordDto.newPassword`
      reuses `RegisterDto`'s bounds and `PASSWORD_COMPLEXITY_REGEX`: 8–72 characters, at least one
      lowercase, one uppercase and one digit, with the failed rule named in the refusal (AC-12).
      `currentPassword` is bounded like `LoginDto`'s — non-empty, ≤72 — and carries no complexity
      check.
- [x] **5.4** Make a session revocable per account — `User.tokenVersion` (already migrated in 1.2)
      becomes a `ver` claim on **every** token this app issues, and `JwtStrategy.validate` gains a
      `FindUserByIdQuery` lookup that refuses the token unless the user exists and
      `(payload.ver ?? 0) === user.tokenVersion` (D-9). A missing `ver` reads as `0`, so tokens
      issued before this ships stay valid until their own `exp` instead of signing everyone out on
      deploy. `UpdateUserPasswordCommand` writes the new hash and `tokenVersion: { increment: 1 }` in
      one `UPDATE`. This touches the authentication path of **every** guarded route in the app.
- [x] **5.5** Issue every token through one handler — `IssueAccessTokenCommand(userId, email,
tokenVersion)` in the auth module owns the claim set `{ sub, email, ver }`, and
      `AuthService.register`, `AuthService.login` **and** the password route all mint through it
      (D-10). Migrating the two existing flows is not optional: leave them signing without `ver` and
      every fresh login for an account that has ever changed its password is refused, because the
      missing claim reads as `0` against a `tokenVersion` of `1`. The password route signs **after**
      the increment and answers `{ accessToken }` alone — the row it was built from never reaches
      the wire (S-1, AC-18) — so the caller continues without signing in again while every other
      token for that account is refused on its next request (AC-13).
- [x] **5.6** Document the revocation and the password route — `docs/modules/module-api-auth.md`
      (the `ver` claim, what the guard now reads, the one-place token minting),
      `module-api-users.md` (the password command and its `tokenVersion` increment),
      `module-api-profile.md` (the route, its `403`, its throttle), Swagger for the new route and
      DTO, JSDoc, and the entry in `apps/api/HISTORY.md`.

**Done when**: the three api suites are green, and `profile.e2e-spec.ts` shows the password changing
(`200` with only `accessToken`), the old password refused at `/auth/login` (`401`), a wrong current
password refused (`403`) with nothing changed, a rule-breaking new password refused (`400`) with the
rule named, the 11th attempt in a minute answering `429`, and a token minted before the change
answering `401` afterwards while the token the change returned still answers `200`.

## Phase 6. Password change on the profile page

**Goal**: the user changes their password from the profile page and both outcomes land — their own
session carries on, and a session revoked elsewhere ends up on `/login`.
**Touches**: web
**Covers**: AC-10, AC-11, AC-12, AC-13, AC-14, AC-17, AC-19
**Decisions**: D-9, D-11, D-12
**Threats**: S-3, S-6
**Verified by**: same as phase 2 — tests first at every tier: the Server Action and the session write
as `src/app/actions/profile.int-spec.ts`, the form's confirmation feedback through Vitest + RTL, and
the two-session behaviour through Playwright with a second browser context in
`apps/web/e2e/profile.spec.ts`. Mandatory security cases: no password and no token in the page
source, the client bundle or any browser-visible response, and the protected page against a revoked
session. UI reviewed with `web-design-guidelines` then `ui-ux-pro-max`. Suites: `npm run test:web`,
`npm run test:e2e:web`.
**Tasks**:

- [ ] **6.1** Cover the password form and the revoked session — tests: `apps/web/e2e/profile.spec.ts`
      for AC-10, AC-11 (the `403` shows in place and the user stays signed in), AC-12 and AC-13 (a
      second browser context signed in as the same account is sent to `/login` on its next action
      after the first changes the password), plus AC-17; `actions/profile.int-spec.ts` for AC-19 (no
      cookie → nothing called, S-3) and for S-6 — the action's returned state, serialised, holds no
      JWT-shaped string; RTL for the confirmation mismatch. Red before 6.2 starts.
- [ ] **6.2** Change the password from the profile page — a form taking the current password, the new
      one and its confirmation, submitting through `changePasswordAction` (D-12), showing a
      confirmation on success and the API's refusal verbatim on failure; a **`403` is a form error
      shown in place, never a sign-out** (D-11); the confirmation-mismatch gate runs server-side in
      the action so it still holds with JavaScript disabled (AC-10, AC-11, AC-12). Like 2.4, it reads
      `getSession()` as its first statement and changes nothing without one (S-3, AC-19). Password
      inputs carry descriptive placeholders, never bullet characters.
- [ ] **6.3** Keep the caller signed in after the change — the action passes the `accessToken` phase
      5 returned straight to `setSessionCookie`, whose expiry follows the new token's own `exp`
      (D-10, AC-13). Its **returned state** is `{ ok: true }` or `{ error }` and never the token or
      the API's response object — an action's return value is serialised into the page payload,
      where `httpOnly` protects nothing (S-6, AC-17).
- [ ] **6.4** Land a revoked session on `/login` — a `401` from `apps/api` is treated as signed-out
      on every page that can now meet one: `/` (already does, via `listMeetings`), `/profile` and
      `/meetings/[id]`, each redirecting before render the way `docs/modules/module-web-auth.md`
      describes; the stale cookie is left to be overwritten at the next real login, since a Server
      Component cannot delete a cookie. `profile-api.ts` keeps `401` (signed out) and `403` (refused,
      stay put) apart (D-11, AC-13, AC-14).
- [ ] **6.5** Document the password flow and close the feature's docs —
      `docs/modules/module-web-profile.md` (the form, the cookie rewrite, the 401/403 split),
      `apps/web/CLAUDE.md`'s Status, JSDoc on every function added, and the entries in
      `apps/web/HISTORY.md` and the root `HISTORY.md` for the feature as a whole.

**Done when**: `npm run test:web` and `npm run test:e2e:web` are green; two browser contexts signed
in as the same account show that changing the password in one leaves that context working and sends
the other to `/login` on its next action; a wrong current password shows in place without signing
anyone out; and the two UI review passes have run.

## Checks

- **1. Numbers** — consistent: 80 in AC-2/AC-3, `MAX_NAME_LENGTH` and `@db.VarChar(80)`; 5 MB in
  AC-7, `MAX_AVATAR_BYTES = 5_242_880` and the 413 message; 8–72 in AC-12 and `RegisterDto`; 10/60 s
  in AC-20, Parameters and S-4's control. The one number in FINAL that is in neither source document
  is T-1's 60-second cache.
- **2. Mechanism against promise** — consistent: D-9's per-request check produces AC-13's "next
  request"; D-7's fresh-key-per-upload produces AC-6's "no longer served" even when an orphan
  survives on disk, because no row references it and no route resolves to it; D-6's content sniffing
  produces AC-8's renamed-file case; D-13's server-rendered `<img>` produces AC-1/AC-5's first
  response.
- **3. Control against scenario** — consistent: S-2's normalisation only removes characters the PRD's
  own assumption calls non-printable, and round 2 kept `U+200E`/`U+200F` so an RTL name survives;
  S-4's 10/minute is far above one deliberate password change; S-3's session check changes nothing a
  signed-in user sees. AC-1's reading against HeroUI's fallback went to the user as **T-2**.
- **4. Missing work** — one gap, closed by hardening rather than a new task: D-10 said
  `AuthService.register`/`login` mint through the new command, and no task said so. 5.5 now does, with
  the consequence spelled out — without it, a fresh login after any password change is refused. The
  migration, the env vars (none), and the characterisation of D-4's move were all already carried.
- **5. Stale citations** — consistent: all thirteen `D-<n>` and all six `S-<n>` are cited by at least
  one phase; every task number cited by the research decision map and the threat map still exists; no
  task is dropped (`- [~]`) and no block carries `**Superseded by**`.
- **6. Order** — consistent after one hardening: 1.2 lands every column in one migration, so phase 3
  and phase 5 add no schema of their own, and 1.5 emits the **full** DTO field set (`hasAvatar: false`
  until phase 3), which is what lets phase 2 render against the final shape and keeps the AC-18
  assertions in 1.1 and 3.1 identical. Each web phase follows the API phase it consumes.
- **7. Phase integrity** — consistent: five live building tasks in phases 1–5, four in phase 6, each
  `tests:` task exempt; one layer per phase; a stop after any phase leaves both apps green.
- **8. Unproven control** — consistent: S-1 → the key-set assertions in 1.1, 3.1 and 5.1; S-2 → the
  four transform cases in 1.1; S-3 → 2.1 and 6.1; S-4 → 5.1's 11th-attempt case; S-5 → 3.1's
  integration case; S-6 → 6.1's serialisation case. Every control lands in a task that names it.
- **9. Silence** — three open mechanisms closed by hardening: how a page refreshes after an avatar
  change (`router.refresh()`, 4.3/4.4), which pages must treat a `401` as signed-out (6.4 names
  three), and which spec file each phase's cases go in (every **Verified by**). Nothing in the
  research is marked "not verified"; every risk carries a fallback.
- **10. Workflow** — consistent: every phase carries **Verified by** quoted from the project's own
  docs, every phase opens with its `tests:` task, phase 3 additionally carries the refactor rule D-4
  made relevant, and both web phases carry the two-skill UI review and the Playwright MCP check.

## Rulings

| Id  | Conflict                                                                                                                                                                     | Sides                | Ruling                                                           | Costs                                                                                                                                                                                                                                                 | Recorded in                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| T-1 | The PRD fenced out resizing, D-8 chose `private, no-store`, AC-5 puts the avatar on every dashboard render — together, up to 5 MB fetched per page view for a 40-pixel image | AC-5/AC-9 vs D-8     | **The control gives way**: `Cache-Control: private, max-age=60`  | A removed or replaced avatar can still paint from the **owner's own** browser cache for up to 60 s at its previous URL; the `?v=<avatarUpdatedAt>` buster means every state change moves the URL, so the window only applies to a URL already fetched | AC-9 amended in the PRD; task 3.5; Residual risk |
| T-2 | AC-1 says "no state that flips after the page hydrates"; HeroUI's `Avatar` shows `Avatar.Fallback` by design until the image loads                                           | AC-1 wording vs D-13 | **Read AC-1 as the project's no-flash rule about session state** | None in work; the initials may flash before the image paints on a slow link                                                                                                                                                                           | AC-1 clarified in the PRD; task 4.5              |

## Deltas from the plan

Every task keeps its number; none was dropped and none was added.

- **1.1** — names its spec files and four transform cases (NUL, DEL, a `U+202E` override, a `U+200F`
  mark that must survive) and spells out the AC-18 assertion as an exact sorted key list — class 8.
- **1.2** — now carries every column of the feature in one named migration (`add_user_profile`), so
  3.2 and 5.4 add no schema — class 6.
- **1.5** — states that the **full** DTO field set ships in phase 1, with `hasAvatar: false` until
  phase 3, so phase 2 renders against the final shape — class 6.
- **2.2** — names `401`-vs-`403` distinguishability, which 6.4 depends on — class 9.
- **3.4/3.5** — parameter values, verbatim messages and throttles copied in from the research
  Parameters table; 3.5 carries T-1's `private, max-age=60` in place of `no-store` — T-1, class 1.
- **4.3/4.4** — name `router.refresh()` as what re-renders after an avatar change, and state
  explicitly that the browser-side type check is a convenience, not the boundary — class 9.
- **5.5** — relabelled to _Issue every token through one handler_, and now requires
  `AuthService.register`/`login` to mint through `IssueAccessTokenCommand`, with the failure it
  prevents named — class 4.
- **6.4** — names the three pages that must treat a `401` as signed-out — class 9.
- Every phase's **Verified by** now names the suite command and the spec file its cases go in, and
  phases 1, 3 and 5 name `npm run db:up` as their precondition — class 10.

## Residual risk

- **T-1's cache window.** For up to 60 seconds after a removal, the owner's own browser can still
  paint the deleted avatar from cache if it re-requests the exact previous URL. Nobody else can: the
  header is `private`, the route is guarded, and every state change moves the `?v=` value. AC-9 is
  amended to say this rather than leaving the criterion technically overstated.
- **Orphaned avatar bytes (S-5, held).** A failed unlink, or two uploads for one account
  interleaving, leaves up to 5 MB of unreachable bytes per occurrence. Avatars are outside the 20 GB
  per-owner accounting, so nothing counts them. A sweep in `FilesPurgeService` is the obvious later
  fix and is **handed to a future iteration**, not carried here.
- **Full-size avatars in the page.** With resizing out of scope, a 5 MB upload is a 5 MB download the
  first time each browser sees it. T-1 reduces the repetition, not the first fetch. The real fix —
  resizing at upload — needs a new `D-<n>` through `/bldprj:research` and a PRD change, and is
  handed to `/bldprj:prd` for a later iteration.
- **A per-request database read on every guarded route** (D-9, accepted by the user on 2026-08-17).
  Bounded by the global 20 req/60 s throttle and reachable only with a signature-valid token.
- **EXIF and image bombs** stay unaddressed by design: an avatar is owner-only and the server never
  decodes it. Both become findings the day an avatar is shown to another user — recorded in THREATS.

## Asked & assumed

- **Asked** — Whether `no-store` on the avatar (D-8) or the PRD's no-resizing fence should give way,
  given up to 5 MB per page render → **T-1**: the control gives way, `private, max-age=60`, and AC-9
  is amended to name the 60-second window.
- **Asked** — Whether AC-1's "no state that flips after the page hydrates" forbids HeroUI's fallback
  showing while the image loads → **T-2**: AC-1 is the project's no-flash rule about session state;
  the fallback is an image load, and AC-1 is clarified to say so.
- **Assumed** — Doc tasks (1.6, 2.6, 3.6, 4.6, 6.5) answer to the project's documentation convention
  rather than to an `AC-<n>` · if close-out expects every task to trace to a criterion, these five
  are the exception and the reason is the root `CLAUDE.md`.
- **Assumed** — The e2e cases for both apps live in one new spec file each
  (`apps/api/test/profile.e2e-spec.ts`, `apps/web/e2e/profile.spec.ts`), with `home.spec.ts` extended
  for the dashboard cases · splitting them per phase changes only the **Verified by** lines.
- **Assumed** — `hasAvatar`/`avatarUpdatedAt` shipping in phase 1's DTO as `false`/`null` is
  preferable to a field set that grows in phase 3 · the alternative would make the AC-18 assertion in
  1.1 disagree with the one in 3.1, and force phase 2 to render against a shape that changes.
