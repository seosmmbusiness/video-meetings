# apps/web/src (meeting page + file proxy)

Architecture and function reference for the meeting detail page (`/meetings/[id]`), the
same-origin proxies that serve and accept a file's bytes without ever exposing the session token
to the browser, the multi-file uploader, and in-page preview/delete/restore. Part of the
`meeting-file-upload` feature — see `docs/archive/meeting-file-upload/` for the PRD, research and
threat model this module implements (phase 4 built the page and download; phase 5 added upload;
phase 6 added playback/preview and delete/restore — see
`docs/archive/meeting-file-upload/meeting-file-upload-FINAL.md`).

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
  meeting's title/description/date/participants (`MeetingDetails`), its live files or an empty
  state (`FilesSection`/`FileListItem`), and its soft-deleted files or an empty state
  (`DeletedFilesSection`/`DeletedFileListItem`), each file name as a React child — never
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
  Shared by both proxy routes for the same reason (D-6).
- `app/api/meetings/[meetingId]/files/route.ts` — a Route Handler, same-origin with the page.
  `POST` calls `getSession()` first and returns a bodyless `401` without opening any upstream
  request when there's no session (S-4); otherwise delegates to `proxyToApi` against
  `/meetings/:meetingId/files`. The request body streams through rather than buffering (D-6), which
  is what lets `XMLHttpRequest.upload.onprogress` on the browser side report real intermediate
  progress instead of jumping straight to 100%.
- `components/files/file-uploader.tsx` — `'use client'`. `FileUploader({ meetingId })`: selecting N
  files in the native (visually hidden) file input starts N independent `XMLHttpRequest` transfers
  against the upload route above, one row per file, each tracking its own `uploading`/`failed`
  state independently of the others (AC-2). A file already over `MAX_FILE_BYTES` is caught by
  `file.size` before any request is built (AC-5's browser-side half). Progress comes from
  `xhr.upload.onprogress` into a HeroUI `ProgressBar`; Cancel calls `xhr.abort()`, which removes the
  row outright (task 5.3) rather than leaving it failed; any non-2xx response or `xhr.onerror` shows
  the row as failed in a HeroUI `Alert` with Retry (re-sends the same `File` object from the first
  byte) and Dismiss. A successful upload removes its own row and calls `useRouter().refresh()`
  (D-10), which re-renders the server-fetched `Files` list with no navigation — this is why a
  completing row and its committed list entry can be momentarily indistinguishable by filename
  alone (see Gotchas).
- `lib/file-limits.ts` — `MAX_FILE_BYTES` and `FILE_SIZE_LIMIT_MESSAGE`, hand-duplicated from
  `apps/api`'s `files.constants.ts` (no shared types package) so the client-side size check and its
  message match the server's 413 exactly.
- `lib/file-preview.ts` — plain module (no `'use client'`), so both the Server Component that
  decides whether to render a preview toggle at all and the Client Component that renders the
  toggle's content can import it. `isPreviewableType(mimeType)` hand-duplicates
  `FilesController`'s `isInlineType` split (D-7): `image/*`, `video/*`, `audio/*` and
  `application/pdf` are previewable, everything else downloads only (AC-10).
- `components/files/file-preview.tsx` — `'use client'`. `FilePreview({ src, mimeType, name })`: a
  collapsed-by-default Preview/Hide toggle that renders `<video controls>`/`<audio controls>` (both
  seekable — phase 1's byte route already answers `Range`), `<img>`, or an `<iframe>` for a PDF
  (rendered by the browser's own viewer, S-8) in place, without navigating away. Only rendered by
  `FileListItem` for a type `isPreviewableType` accepts.
- `app/actions/files.ts` — `'use server'`. `deleteFileAction`/`restoreFileAction`: read `meetingId`
  and `fileId` from the submitted `FormData` (never trusted for identity beyond that — the caller
  comes from `getSession()`), call apps/api's `DELETE`/`POST .../restore`, then `refresh()` from
  `next/cache` so the current route re-renders with no client-side fetch of its own (D-10) — legal
  here because these are tiny, progressless mutations, unlike the streamed upload in phase 5's Route
  Handler.
- `lib/files-api.ts` — server-only fetch client, shaped like `lib/meetings-api.ts`:
  `getMeeting(token, meetingId)` (`GET /meetings/:id`), `listFiles(token, meetingId)`
  (`GET /meetings/:meetingId/files`), `listDeletedFiles(token, meetingId)`
  (`GET /meetings/:meetingId/files/deleted`), `deleteFile(token, meetingId, fileId)`
  (`DELETE .../:fileId`) and `restoreFile(token, meetingId, fileId)` (`POST .../:fileId/restore`).
  All `cache: 'no-store'`, all throw `ApiError` on a non-2xx response, all `encodeURIComponent` the
  meeting/file id into the path.
- `app/page.tsx` (home) — `MeetingListItem` now wraps its row in a `next/link` `Link` to
  `/meetings/<id>` (AC-19), replacing the plain `<li>`.
- `e2e/meeting-page.spec.ts` — Playwright coverage: the meeting's own fields, the file list and its
  empty state, a download whose bytes match what was uploaded, `Cache-Control: private` on that
  response, the signed-out redirect, not-found parity for another owner's meeting vs. a nonexistent
  one, a script-markup file name rendered as text (with a `page.on('dialog', …)` guard proving
  nothing executes), the dashboard-row link, and three proxy-route cases: a cleared session
  answering `401` with no body, a caller-supplied `Authorization` header changing nothing, and a
  nonexistent file id passing the upstream `404` straight through. Runs against a real `apps/api` +
  Postgres, like `home.spec.ts`; seeds meetings and files through the API directly.
- `e2e/meeting-file-upload.spec.ts` — Playwright coverage for the uploader: independent multi-file
  landing without a reload and surviving one, at least three distinct intermediate percentages on a
  generated 100 MB silent WAV (a real accepted file — a blob of zeros would be refused by type
  before any progress could be observed), a per-row cancel removing its row within 2 s while the
  batch continues and nothing is stored, a failed row (simulated with `page.route(...).abort()`)
  whose Retry succeeds, and all four refusal messages (413 client-side via a spoofed oversized
  `File.size`, 415 with a real random-bytes fixture, 409 by seeding 20 real files first, 507 via
  `page.route(...).fulfill()` since exhausting a real 20 GB quota isn't practical in e2e — apps/api's
  own suite already proves that ceiling trips a 507; this spec only proves the message survives the
  hop verbatim). Registers exactly one owner account in `test.describe.configure({ mode: 'serial' })`
  rather than one per test, since registration has no credential to key its throttle on yet and is
  tracked per-IP (D-9) — every spec file in this suite shares one loopback IP when run together.
- `e2e/meeting-file-preview.spec.ts` — Playwright coverage for phase 6: in-page playback of a
  minimal-but-valid MP4/WAV (video/audio), in-page rendering of a minimal PNG/PDF (image/PDF, only
  asserting the embedded element and its `src` — a synthetic fixture isn't a document Chrome's own
  PDF viewer can fully parse, and that isn't what AC-10 is testing), a `.txt` row offering no Preview
  control at all, delete moving a file into "Deleted files" with its time-left text and freeing a
  20-file-cap slot (proven by a 409 before delete, a successful identical upload after), the file's
  content route answering `404` once deleted, restore returning it to the live list and downloadable
  again, and a `deletedAt` backdated 31 days via `docker compose exec db psql` (apps/web's e2e runs
  as a separate process against a real HTTP apps/api, unlike apps/api's own suite which backdates
  through an in-process `PrismaService`, D-11) absent from "Deleted files" entirely. Also registers
  one shared owner account in serial mode, for the same reason as `meeting-file-upload.spec.ts`.

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
  401 branch (expired, tampered, or revoked by a password change made elsewhere — see
  `module-web-profile.md`) redirects to `/login`, checked _before_ the 404 branch
  (nonexistent-or-not-owned), matching `app/page.tsx`'s existing precedent — a session that
  `apps/api` no longer honors is signed-out, not merely "page not found".
- **`getMeeting`/`listFiles` are called sequentially, not via `Promise.all`.** Fetching the meeting
  first means a 404 or 401 on it skips the files call entirely, saving a request against
  `apps/api`'s per-credential throttle for a page that's about to redirect or 404 anyway.
- **A file's name is visible in two different lists while it's uploading**, and a test (or a
  screen-reader user) has to be told which one it means. `FileUploader`'s in-progress rows live in a
  `<ul aria-label="Uploads">`; the server-rendered committed rows live in a `<ul aria-label="Files">`
  — both were unlabeled `<ul>`s until phase 5 added the second one, and an assertion (or a
  `getByText`) scoped to neither will happily match a row that's still uploading and call it
  "landed". Scope by list name, not just by text, whenever "did the upload finish" is the question.
- **Cancel and a network/server failure are different terminal states, deliberately.**
  `xhr.onabort` (user-initiated, `row.xhr?.abort()`) removes the row outright; `xhr.onerror` and a
  non-2xx `xhr.onload` set `status: 'failed'` and keep the row with Retry/Dismiss. Collapsing these
  into one path would either leave a cancelled file offering a pointless Retry, or silently drop a
  file that failed through no action of the user's.
- **Retry re-uses the same `File` object already held in component state**, not a re-prompt — the
  browser's file picker never reopens. This is what lets Retry "re-send the whole file from the
  first byte" (AC-9) without asking the user to reselect it.
- **`getByRole('list', { name: 'Files' })` also matches `<ul aria-label="Deleted files">`.**
  Playwright's accessible-name matching is a case-insensitive substring by default, and "Files" is
  literally a substring of "Deleted files" — a `.spec.ts` that scopes by list name without
  `{ exact: true }` silently gets both lists, and an assertion that a file "is no longer in Files"
  after a delete can pass even while it's actually sitting in the other list the query also matched.
  Every list-name lookup in this module's specs now passes `exact: true`.
- **A synthetic PDF fixture makes the `<iframe>` load but not render.** `file-type` only checks the
  `%PDF` signature, so a few bytes are enough for apps/api to accept and serve the file; Chrome's
  built-in PDF viewer inside the `<iframe>` then tries to actually parse the document and shows its
  own "Failed to load PDF document" error. That's expected and not a bug — AC-10 only asks that the
  file render "in place, without navigating away," which the `<iframe>` embedding the correct `src`
  already satisfies; e2e coverage asserts the element and its `src`, not that the viewer's own parser
  succeeds on a fixture with no real page content.
- **`deleteFileAction`/`restoreFileAction` derive the caller from `getSession()`, not from the
  form.** The form only ever supplies `meetingId`/`fileId` — per Next's own Server Actions guidance,
  a client can send a well-formed POST to any action's endpoint directly, bypassing the UI entirely,
  so identity has to come from the trusted session cookie every time, with apps/api's own
  `MeetingOwnerGuard` re-checking ownership as the second, independent line.

## Function reference

- `MeetingPage(props): Promise<JSX.Element>` (`app/meetings/[id]/page.tsx`) — the auth-gated,
  not-found-on-404 meeting detail page described above.
- `MeetingDetails({ meeting }): JSX.Element` (`app/meetings/[id]/page.tsx`) — title, description,
  formatted date, and a `Chip` per participant.
- `FilesSection({ meetingId, files }): JSX.Element` (`app/meetings/[id]/page.tsx`) — the live file
  list, or an `EmptyState` reading "No files have been uploaded yet." when `files` is empty.
- `FileListItem({ file, meetingId }): JSX.Element` (`app/meetings/[id]/page.tsx`) — one live file
  row: name, formatted size/type/upload time, a Preview toggle when `isPreviewableType` accepts the
  file's type, and Download/Delete controls.
- `DeletedFilesSection({ meetingId, files }): JSX.Element` (`app/meetings/[id]/page.tsx`) — the
  deleted file list, or an `EmptyState` reading "Nothing has been deleted." when `files` is empty.
- `DeletedFileListItem({ file, meetingId }): JSX.Element` (`app/meetings/[id]/page.tsx`) — one
  deleted file row: name, time left before purge, and a Restore control.
- `formatFileSize(bytes: number): string` (`app/meetings/[id]/page.tsx`) — `B`/`KB`/`MB`/`GB`,
  choosing the largest unit that keeps the number under 1024.
- `formatTimeLeft(purgeAt: string): string` (`app/meetings/[id]/page.tsx`) — a countdown to a
  deleted file's purge, e.g. "12 days left", "1 day left", "Purging today".
- `getMeeting(token: string, meetingId: string): Promise<Meeting>` (`lib/files-api.ts`) —
  `GET /meetings/:id`.
- `listFiles(token: string, meetingId: string): Promise<MeetingFile[]>` (`lib/files-api.ts`) —
  `GET /meetings/:meetingId/files`.
- `listDeletedFiles(token: string, meetingId: string): Promise<MeetingFile[]>`
  (`lib/files-api.ts`) — `GET /meetings/:meetingId/files/deleted`.
- `deleteFile(token: string, meetingId: string, fileId: string): Promise<void>`
  (`lib/files-api.ts`) — `DELETE /meetings/:meetingId/files/:fileId`.
- `restoreFile(token: string, meetingId: string, fileId: string): Promise<MeetingFile>`
  (`lib/files-api.ts`) — `POST /meetings/:meetingId/files/:fileId/restore`.
- `proxyToApi(request: Request, token: string, path: string): Promise<Response>`
  (`lib/api-proxy.ts`) — the allow-listed forwarder described above.
- `GET(request, { params }): Promise<Response>`
  (`app/api/meetings/[meetingId]/files/[fileId]/content/route.ts`) — `401` with no body when
  signed out; otherwise `proxyToApi` against `/meetings/:meetingId/files/:fileId/content`.
- `POST(request, { params }): Promise<Response>`
  (`app/api/meetings/[meetingId]/files/route.ts`) — `401` with no body when signed out; otherwise
  `proxyToApi` against `/meetings/:meetingId/files`, streaming the multipart body through.
- `FileUploader({ meetingId }): JSX.Element` (`components/files/file-uploader.tsx`) — the file
  picker button and the list of in-progress/failed upload rows described above.
- `extractUploadErrorMessage(responseText: string, status: number): string`
  (`components/files/file-uploader.tsx`) — pulls the display message out of an upload response body
  shaped like every other apps/api error (`message: string | string[]`), falling back to a
  status-based string when the body isn't parseable JSON (a network failure never reached the
  server at all).
- `isPreviewableType(mimeType: string): boolean` (`lib/file-preview.ts`) — the browser-side mirror
  of `FilesController.isInlineType`, described above.
- `FilePreview({ src, mimeType, name }): JSX.Element` (`components/files/file-preview.tsx`) — the
  Preview/Hide toggle and its embedded media element, described above.
- `deleteFileAction(formData: FormData): Promise<void>` (`app/actions/files.ts`) — soft-deletes the
  file named by the form's `meetingId`/`fileId` and refreshes the route.
- `restoreFileAction(formData: FormData): Promise<void>` (`app/actions/files.ts`) — restores the
  file named by the form's `meetingId`/`fileId` and refreshes the route.

## DTOs

- `MeetingFile` (`lib/files-api.ts`) — `{ id, meetingId, name, size, mimeType, createdAt, deletedAt,
purgeAt }`, matching `apps/api`'s `MeetingFileResponseDto` exactly (see `module-api-files.md`).
