# apps/web/src (meeting page + file proxy)

Architecture and function reference for the meeting detail page (`/meetings/[id]`) and the
same-origin proxy that serves a file's bytes to the browser without ever exposing the session
token. Part of the `meeting-file-upload` feature — see `docs/meeting-file-upload/` for the PRD,
research and threat model this module implements (phase 4:
`docs/meeting-file-upload/meeting-file-upload-FINAL.md`).

This module talks to `apps/api`'s `src/meetings` (`GET /meetings/:id`, see
`module-api-meetings.md`) and `src/files` (`GET /meetings/:meetingId/files`,
`GET /meetings/:meetingId/files/:fileId/content`, see `module-api-files.md`) — there's no shared
types package between the two apps, so `lib/files-api.ts`'s `MeetingFile` shape is hand-duplicated
from `MeetingFileResponseDto` and must be kept in sync manually if that DTO changes. It reuses
`module-web-auth.md`'s `Meeting` type, `lib/session.ts` and the `auth-api.ts`/`meetings-api.ts`
request/error conventions rather than duplicating them.

## Architecture

- `app/meetings/[id]/page.tsx` — an `async` Server Component, the same auth-gated shape as the home
  page: `getSession()` first, `redirect('/login')` before any JSX if there's no session or if
  `getMeeting`/`listFiles` 401s. A 404 from either call — a nonexistent meeting id or one belonging
  to another owner, indistinguishable by design (`apps/api`'s `findOneForOwner`) — calls Next's
  `notFound()`, so both cases render the identical built-in not-found page (AC-15). Renders the
  meeting's title/description/date/participants (`MeetingDetails`) and its files or an empty state
  (`FilesSection`/`FileListItem`), each file name as a React child — never
  `dangerouslySetInnerHTML` — so markup in a name is literal text (AC-18).
- `app/api/meetings/[meetingId]/files/[fileId]/content/route.ts` — a Route Handler, same-origin
  with the page, so it carries the `httpOnly` session cookie a `<video>`/`<img>`/`<a>` can send but
  no script-attached header can. `GET` calls `getSession()` first and returns a bodyless `401`
  without opening any upstream request when there's no session (S-4); otherwise delegates to
  `lib/api-proxy.ts`'s `proxyToApi`. Next 16 hands `params` as a Promise, awaited before use.
- `lib/api-proxy.ts` — `proxyToApi(request, token, path)`: rebuilds the upstream request from an
  allow-list (`method`, `body`, `content-type`, `content-length`, `range`) with the session's bearer
  token attached server-side; the caller's own `Authorization` header, if any, is never read or
  forwarded. Passes only `content-type`/`content-length`/`content-disposition`/`accept-ranges`/
  `content-range`/`cache-control` back from the upstream response, so `apps/api`'s
  `Cache-Control: private, no-store` (S-7) and refusal statuses/messages survive the hop unchanged.
  Shared by this route today; phase 5's upload route reuses it for the same reason (D-6).
- `lib/files-api.ts` — server-only fetch client, shaped like `lib/meetings-api.ts`:
  `getMeeting(token, meetingId)` (`GET /meetings/:id`) and `listFiles(token, meetingId)`
  (`GET /meetings/:meetingId/files`). Both `cache: 'no-store'`, both throw `ApiError` on a non-2xx
  response, both `encodeURIComponent` the meeting id into the path.
- `app/page.tsx` (home) — `MeetingListItem` now wraps its row in a `next/link` `Link` to
  `/meetings/<id>` (AC-19), replacing the plain `<li>`.
- `e2e/meeting-page.spec.ts` — Playwright coverage: the meeting's own fields, the file list and its
  empty state, a download whose bytes match what was uploaded, `Cache-Control: private` on that
  response, the signed-out redirect, not-found parity for another owner's meeting vs. a nonexistent
  one, a script-markup file name rendered as text (with a `page.on('dialog', …)` guard proving
  nothing executes), the dashboard-row link, and three proxy-route cases: a cleared session
  answering `401` with no body, a caller-supplied `Authorization` header changing nothing, and a
  nonexistent file id passing the upstream `404` straight through. Runs against a real `apps/api` +
  Postgres, like `home.spec.ts`; seeds meetings and files through the API directly rather than the
  (not yet built) upload UI.

## Gotchas (non-obvious, worth preserving)

- **The download control is a plain `<a href>`, not `next/link`.** The target is a Route Handler,
  not a page in the App Router's route tree — `next/link` prefetches and client-navigates within
  that tree, which is the wrong behavior for a byte-serving endpoint. Styled via `@heroui/styles`'s
  `buttonVariants({ variant, size })` passed as `className`, the same pattern
  `module-web-auth.md`'s Gotchas documents for `linkVariants` on the register/login cross-links —
  passing a HeroUI `Button`'s function props across the Server→Client boundary isn't an option here
  either, and this anchor doesn't need to be a Client Component at all.
- **`proxyToApi` never trusts the incoming request's own headers except the three allow-listed
  ones.** An early version might be tempted to spread `request.headers` onto the upstream request
  for convenience; that would forward the caller's own `Authorization` (or any other header) to
  `apps/api`, which is exactly the S-4 hole the allow-list closes. Any new header the proxy needs to
  forward (e.g. `If-Range` for phase 6's playback) is an explicit addition to
  `FORWARDED_REQUEST_HEADERS`, never a blanket pass-through.
- **A 401 from `getMeeting`/`listFiles` and a 404 are handled differently, and order matters.** The
  401 branch (expired/tampered token) redirects to `/login`, checked _before_ the 404 branch
  (nonexistent-or-not-owned), matching `app/page.tsx`'s existing precedent — a session that
  `apps/api` no longer honors is signed-out, not merely "page not found".
- **`getMeeting`/`listFiles` are called sequentially, not via `Promise.all`.** Fetching the meeting
  first means a 404 or 401 on it skips the files call entirely, saving a request against
  `apps/api`'s per-credential throttle for a page that's about to redirect or 404 anyway.

## Function reference

- `MeetingPage(props): Promise<JSX.Element>` (`app/meetings/[id]/page.tsx`) — the auth-gated,
  not-found-on-404 meeting detail page described above.
- `MeetingDetails({ meeting }): JSX.Element` (`app/meetings/[id]/page.tsx`) — title, description,
  formatted date, and a `Chip` per participant.
- `FilesSection({ meetingId, files }): JSX.Element` (`app/meetings/[id]/page.tsx`) — the file list,
  or an `EmptyState` reading "No files have been uploaded yet." when `files` is empty.
- `FileListItem({ file, meetingId }): JSX.Element` (`app/meetings/[id]/page.tsx`) — one file row:
  name, formatted size/type/upload time, and a Download control pointed at the proxy route.
- `formatFileSize(bytes: number): string` (`app/meetings/[id]/page.tsx`) — `B`/`KB`/`MB`/`GB`,
  choosing the largest unit that keeps the number under 1024.
- `getMeeting(token: string, meetingId: string): Promise<Meeting>` (`lib/files-api.ts`) —
  `GET /meetings/:id`.
- `listFiles(token: string, meetingId: string): Promise<MeetingFile[]>` (`lib/files-api.ts`) —
  `GET /meetings/:meetingId/files`.
- `proxyToApi(request: Request, token: string, path: string): Promise<Response>`
  (`lib/api-proxy.ts`) — the allow-listed forwarder described above.
- `GET(request, { params }): Promise<Response>`
  (`app/api/meetings/[meetingId]/files/[fileId]/content/route.ts`) — `401` with no body when
  signed out; otherwise `proxyToApi` against `/meetings/:meetingId/files/:fileId/content`.

## DTOs

- `MeetingFile` (`lib/files-api.ts`) — `{ id, meetingId, name, size, mimeType, createdAt, deletedAt,
purgeAt }`, matching `apps/api`'s `MeetingFileResponseDto` exactly (see `module-api-files.md`).
