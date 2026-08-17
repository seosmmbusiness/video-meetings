# PRD: User profile

**Key**: UP
**Date**: 2026-08-17
**Status**: draft

## 1. Goal

A signed-in user can maintain their own account: set the name they are shown under, put a face on
it, and change their password without leaving the app. Today an account is an email address and
nothing else — the dashboard greets everyone with a raw email, and a password can only be changed
by someone with database access.

## 2. User scenarios

- Signed-in user → opens the profile page → sees their email, their current name (empty until they
  set one) and their current avatar (a default placeholder until they upload one).
- Signed-in user → types a name and saves → the name is stored, and both the profile page and the
  dashboard show it instead of the email.
- Signed-in user → clears the name and saves → the name is removed, and both pages show the email
  again.
- Signed-in user → submits a name longer than the limit → the save is refused with the limit stated
  and the stored name is unchanged.
- Signed-in user → uploads a PNG, JPEG or WebP of at most 5 MB → the image becomes their avatar and
  appears on the profile page and next to them on the dashboard.
- Signed-in user → uploads an image over 5 MB → the upload is refused with the limit stated and the
  current avatar is unchanged.
- Signed-in user → uploads a file that is not a PNG, JPEG or WebP → the upload is refused with the
  accepted formats stated and the current avatar is unchanged.
- Signed-in user → removes their avatar → the profile page and the dashboard fall back to the
  default placeholder, and the removed image is no longer served.
- Signed-in user → enters their current password and a valid new one → the password is changed, the
  user is told so, and their current session keeps working.
- Signed-in user → enters a wrong current password → the change is refused, stating that the current
  password is wrong; nothing is changed and no session is ended.
- Signed-in user → enters a new password that breaks the password rules, or that does not match its
  confirmation → the change is refused with the failed rule stated and nothing is changed.
- Signed-in user on a second device → after the password was changed elsewhere → their next action
  is refused and they land on the login page.
- Signed-out visitor → opens the profile page → is sent to the login page and sees no profile data.
- Signed-in user → tries to read or change another account's name, avatar or password → is refused
  and learns nothing about that account.

## 3. Scope

**In scope**

- A profile page for the signed-in user, reachable from the dashboard, showing email, name and
  avatar.
- Setting, changing and clearing the user's own name — optional, up to 80 characters after trimming.
- Uploading an avatar: PNG, JPEG or WebP, at most 5 MB, replacing the previous one.
- Removing the avatar, returning to the default placeholder.
- Showing the avatar on the profile page and on the dashboard next to the user, alongside the name
  when set and the email when not.
- Changing the password from the profile page, gated on the current password and on the same
  password rules registration enforces, with a confirmation field.
- Ending every **other** session of that account the moment the password changes, while the session
  that made the change keeps working.
- Refusal messages for each of the failures above, stated on the page next to the action that
  failed.

**Out of scope**

- Changing the email address — it is the login identity and the account's unique key, so it needs a
  verification round-trip of its own.
- Password reset for a user who cannot sign in ("forgot password") — needs outbound email, which
  this project has no mechanism for.
- Deleting the account — needs a ruling on what happens to that owner's meetings and files first.
- Collecting the name at registration — `/register` and `RegisterDto` stay as they are; a name is
  something an existing account gains, and every account already registered has none.
- Forcing a user with no name to fill one in — an empty name stays a valid state.
- Showing anyone's avatar to anyone else: a meeting's `participants` are email strings, not
  accounts, so there is no second user on any screen to show an avatar for.
- Cropping, rotating, resizing or generating thumbnails — the uploaded image is stored and shown as
  it arrived, scaled by the browser.
- Animated GIF avatars — animation is a separate rendering and content-inspection problem for a
  picture shown at 40 px.
- Avatar history, undo or restore — unlike a meeting file, a replaced or removed avatar is gone; the
  fix is uploading another one.
- A public or shareable avatar URL — the image is readable by its owner only.
- A session/device list, "sign out everywhere" as its own control, or two-factor authentication —
  the only session effect in this iteration is the one a password change causes.
- Any other profile setting (locale, timezone, theme, notifications).

## 4. Technical constraints

- The `User` model today is `id`, `email`, `passwordHash`, `consentToTerms`, `createdAt`,
  `updatedAt` (`apps/api/prisma/schema.prisma`). It carries neither a name nor an avatar, so both
  arrive as a schema migration, and **every already-registered account starts with neither**.
- Sessions are stateless JWTs signed by `apps/api` (`{ sub, email }`, `JWT_EXPIRES_IN` default
  `1h`) and verified per-request by `JwtAuthGuard` without reading the database. Expiry alone
  therefore cannot end another session on demand — "every other session ends immediately" is work
  this feature has to carry, not a property the current setup already has.
- `apps/web` holds that token in an `httpOnly` cookie the browser can never read, and moves file
  bytes through same-origin proxy Route Handlers that attach the token server-side. Anything the
  avatar needs must fit that shape — the token does not reach the browser.
- Auth-gated pages redirect server-side before rendering, and no user/session state may be read
  client-side after mount (`apps/web/CLAUDE.md`'s no-flash rule) — the name and the avatar are part
  of the dashboard's first server-rendered response.
- Passwords are bcrypt hashes produced by `apps/api/src/credentials`, capped at 72 bytes, and
  registration enforces ≥8 characters with at least one uppercase, one lowercase and one digit.
- Uploaded bytes live behind the abstract `FileStorage` boundary on local disk under `STORAGE_ROOT`,
  which is mandatory in production and gitignored in development.
- Redis is optional infrastructure project-wide: nothing here may fail, or behave differently in a
  way the user notices, when Redis is absent or unreachable.
- Both apps are developed test-first across unit, integration and e2e, and security cases are
  mandatory at each tier that can prove them (root `CLAUDE.md`, Testing).
- `apps/api` documents every route and DTO with `@nestjs/swagger`; `apps/web` builds its UI from
  HeroUI v3 on Tailwind v4, theme fixed to light.

## 5. Acceptance criteria

- [ ] **AC-1** A signed-in user opening the profile page sees, in the server's first response, their
      email, their current name (blank when never set) and their current avatar (the default
      placeholder when none is set) — no state that flips after the page hydrates.
- [ ] **AC-2** Saving a name of 1–80 characters stores it with leading and trailing whitespace
      removed; reloading the profile page and the dashboard both show the stored value.
- [ ] **AC-3** Saving a name longer than 80 characters after trimming is refused with a message
      naming the 80-character limit, and the previously stored name is unchanged.
- [ ] **AC-4** Submitting an empty name clears it, and the dashboard shows the email again.
- [ ] **AC-5** The dashboard shows the user's name when one is set and their email when none is,
      next to their avatar, in the server-rendered HTML.
- [ ] **AC-6** Uploading a PNG, JPEG or WebP of at most 5 MB replaces the avatar: the profile page
      and the dashboard show the new image on their next render, and the replaced image's bytes are
      no longer served to anyone.
- [ ] **AC-7** Uploading an image larger than 5 MB is refused with a message naming the 5 MB limit,
      stores no bytes, and leaves the current avatar (or its absence) exactly as it was.
- [ ] **AC-8** Uploading a file whose **content** is not PNG, JPEG or WebP is refused with a message
      naming the three accepted formats, and stores nothing — including a file renamed to `.png`
      whose content is something else.
- [ ] **AC-9** Removing the avatar returns the profile page and the dashboard to the default
      placeholder, and the removed image's bytes are no longer served.
- [ ] **AC-10** A password change submitted with the correct current password succeeds and says so;
      the new password then works at `/login` and the old one is refused there.
- [ ] **AC-11** A password change submitted with a wrong current password is refused with a message
      saying the current password is wrong; the stored password is unchanged and no session is
      ended.
- [ ] **AC-12** A new password that breaks the registration rules (≥8 characters, at least one
      uppercase, one lowercase and one digit, at most 72) or that differs from its confirmation
      field is refused with the failed rule stated, and nothing is changed.
- [ ] **AC-13** After a successful password change, every **other** session of that account is
      refused on its next request and lands on `/login`, while the session that performed the change
      continues working without signing in again.
- [ ] **AC-14** A visitor with no session, or with an invalid or expired one, is redirected from the
      profile page to `/login`, and the response carries no name, email or avatar.
- [ ] **AC-15** Signed-in user B cannot read or change user A's name, avatar or password: no route
      accepts another account's identifier as the subject of the change, and a request for A's
      avatar bytes made as B answers with a refusal, never the image.
- [ ] **AC-16** A name containing HTML or script markup is shown verbatim as text on the profile
      page and the dashboard and executes nothing.
- [ ] **AC-17** Neither the session token nor any password — current or new — appears in the profile
      page's HTML source, its client bundle, or any browser-visible response it makes.
- [ ] **AC-18** No response from any profile route carries the account's password hash, its
      session-revocation counter or its avatar storage key: each response body holds exactly the
      fields the profile shows, and nothing else.
- [ ] **AC-19** A profile Server Action invoked without a valid session — by a direct request rather
      than through the rendered form — changes nothing and makes no call on the user's behalf.
- [ ] **AC-20** The password-change route refuses more than 10 attempts per minute from one caller,
      answering the refusal rather than checking the password an 11th time.

## Asked & assumed

- **Asked** — Avatar limits, size and formats → 5 MB, PNG/JPEG/WebP; animated GIF stays out of
  scope.
- **Asked** — What happens to sessions after a successful password change → every other session ends
  immediately; the session that changed the password keeps working.
- **Asked** — Whether an avatar can be removed rather than only replaced → yes, a remove control
  returning to the default placeholder.
- **Asked** — Whether the name is required, and what the dashboard shows → optional; the dashboard
  shows the name when set and the email when not, leaving `/register` untouched.
- **Assumed** — The avatar is private to its owner, because no screen in the app shows one user to
  another (`participants` are email strings, not accounts) · if a screen ever shows other users, who
  may see whose avatar becomes a new product decision and a new criterion, not a widening of AC-15.
- **Assumed** — The profile page is reached from the dashboard, next to the existing sign-out
  control, and lives at its own route · if it should instead be a dialog or a section of the
  dashboard, the scenarios stay identical and only AC-1/AC-14's "page" becomes "view".
- **Assumed** — A name may contain any printable characters up to the length limit, including
  non-Latin scripts, and is not checked for uniqueness · if names must be unique or restricted to a
  character set, AC-2 and AC-3 gain a refusal case each.
- **Assumed** — The 80-character name limit is this document's number, not one the user gave · if it
  is wrong it is a one-line change in AC-2, AC-3 and the scope entry.
- **Assumed** — Rate limiting on the password-change route follows the project's existing throttling
  rather than a number stated here · `security-analyse` owns whether the current-password check
  needs a stricter one than the global 20 req/60 s, the way `/auth/login` does. **Settled**: it does
  — AC-20 below, added 2026-08-17.
- **Asked** (2026-08-17, `security-analyse`) — Three controls the threat pass found reachable had no
  criterion to prove them against → the user raised all three: **AC-18** (S-1 — the users module's
  query returns the whole row, hash and revocation counter included), **AC-19** (S-3 — Server
  Actions are reachable by direct POST, not only through the form), **AC-20** (S-4 — the
  password route is a password oracle by construction). AC-1…AC-17 were left untouched.
