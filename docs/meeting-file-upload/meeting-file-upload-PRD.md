# PRD: Meeting file upload

**Key**: MFU
**Date**: 2026-08-08
**Status**: draft

## 1. Goal

A meeting owner needs the recordings and documents belonging to a meeting to live with that meeting: uploaded from the meeting's own page, watched or read there afterwards, removable when wrong, and kept byte-for-byte so a later processing step has something to work on. Today a meeting is a title, a date and a list of participant emails — its actual content sits on the owner's own disk.

## 2. User scenarios

The only account holder in this product is the **meeting owner**; participants are unauthenticated email strings, not users. The negative scenarios below are what everyone else gets.

**Reaching a meeting**

- Meeting owner → opens a meeting from the dashboard → lands on that meeting's own page showing its title, description, date and participants, plus its files or an empty state.

**Uploading**

- Meeting owner → selects several files at once on the meeting page → each file gets its own row with its own advancing progress, and each joins the file list as it finishes, without a page reload.
- Meeting owner → cancels one file that is still uploading → that row goes away, nothing of it is stored, and the other files in the same batch keep uploading.
- Meeting owner → uploads a file over 500 MB → it is rejected with the size limit stated, before any bytes are stored.
- Meeting owner → uploads a file of an unsupported type → it is rejected with the accepted types stated, and the rest of the batch keeps uploading.
- Meeting owner → uploads a file into a meeting that already holds 20 live files → it is rejected with the per-meeting limit stated.
- Meeting owner → uploads a file that would push their stored total past 20 GB → it is rejected with the space remaining stated.
- Meeting owner → loses the connection partway through an upload → the row turns to failed with the reason, offering Retry (which re-sends the whole file) and Dismiss; nothing partial is listed or stored.

**Using what was uploaded**

- Meeting owner → plays an uploaded recording from the file list → it plays inside the meeting page, without navigating away.
- Meeting owner → opens an uploaded image or PDF → it renders inside the page; any other accepted type downloads instead.
- Meeting owner → downloads a file → gets back exactly the bytes that were uploaded.

**Removing**

- Meeting owner → deletes a file → it leaves the main list, appears under "Deleted files" with the time left before it is purged, and frees a slot against the 20-file cap immediately.
- Meeting owner → restores a file from "Deleted files" → it is back in the main list, playable and downloadable again, and occupies a slot again.
- Meeting owner → looks for a file deleted more than 30 days ago → it is gone from "Deleted files" and its stored bytes no longer exist anywhere.

**Everyone else**

- Another signed-in user → opens a meeting page they do not own, or asks for one of its files → gets the same "not found" as for a meeting that does not exist; no filename, size, count or byte is revealed.
- Signed-out visitor → opens a meeting page → is redirected to `/login`; no meeting data and no file content is served.
- Anyone → requests a stored file directly, at the location the bytes live, without a valid session → gets nothing back.

## 3. Scope

**In scope**

- A meeting page at `/meetings/<id>` in `apps/web`, read-only for the meeting's own fields (title, description, date, participants), reachable from the dashboard's meeting rows.
- Uploading one or more files to a meeting from that page: multi-file selection, one row per file, per-file progress, per-file cancel, per-file failure with Retry and Dismiss.
- Accepted types: video (`mp4`, `webm`, `mov`), audio (`mp3`, `wav`, `m4a`), documents (`pdf`, `docx`, `txt`, `md`), images (`png`, `jpg`).
- Limits: 500 MB per file, 20 live files per meeting, 20 GB stored in total per user.
- A file list inside the meeting showing each file's name, size, type and upload time.
- Inline use: video and audio play in place, images and PDFs render in place, every other accepted type downloads.
- Download of the original bytes for any listed file.
- Soft delete: a "Deleted files" area on the meeting page with the time remaining and a Restore control, and permanent removal of the file and its bytes 30 days after deletion.
- Owner-only access to every file and to the meeting page, with the same not-found answer for a meeting someone else owns as for one that does not exist.

**Out of scope**

- Processing the uploaded files (transcription, summarisation, thumbnails, format conversion) — this iteration exists to store them so processing can be built on top later; no processing step exists yet.
- Resumable upload — a failed upload restarts from the first byte, since resume is a substantially larger build than the retry the owner chose.
- Sharing files with meeting participants — participants are unauthenticated email strings, not accounts, so there is nobody to share with until participant accounts exist.
- Editing the meeting's own fields from the new meeting page — `apps/api`'s meetings module has no update endpoint, and adding one is a separate feature.
- Renaming, replacing or versioning an uploaded file — delete plus re-upload covers the need at this size.
- Folders, tags, sorting controls or search across files — a capped list of 20 needs none of them.
- Bulk actions (select-all, delete all, download all) — one file at a time.
- Uploading from anywhere but the meeting page — no dashboard drop zone, no email ingest, no import from cloud drives.
- A trash spanning all meetings — a deleted file is reachable only on its own meeting's page.
- Any quota or storage-usage display — the 20 GB ceiling surfaces only in the rejection message when an upload crosses it.
- Malware or virus scanning of uploaded bytes — no scanner exists in this project or its infrastructure.
- Recovering a purged file — after 30 days it is gone, with no support path to bring it back.

## 4. Technical constraints

- **Two independent apps, no shared types.** `apps/web` is Next.js 16 (App Router, TypeScript, HeroUI v3 on Tailwind v4); `apps/api` is NestJS 11 (TypeScript, Prisma against Postgres 18). There is no shared package, so every request/response shape is hand-duplicated between them and kept in sync manually.
- **`apps/api` owns the data, and its meetings are already owner-scoped.** `GET /meetings/:id` matches on `id` **and** `ownerId` and answers 404 — never 403 — for a meeting owned by someone else, so a response never reveals whether an id exists. Files must not weaken that.
- **Auth is a JWT** issued by `apps/api`, held by `apps/web` in an `httpOnly` session cookie, and enforced on `apps/api` routes by `JwtAuthGuard`. `apps/web` reads session state server-side before render and redirects gated pages to `/login`.
- **A Server Action cannot report upload progress.** `apps/web` currently reaches `apps/api` server-to-server from Server Actions; per-file progress and per-file cancel require the browser itself to observe and abort the transfer. CORS for `apps/web`'s origin is already enabled on `apps/api` (`CORS_ORIGIN`).
- **No object storage, CDN or cloud account is configured.** `docker-compose.yml` provides Postgres 18 and Redis 8 locally, and Redis is optional infrastructure project-wide — nothing may hard-depend on it or fail a request when it is down. The deployment target today is a single machine; there is no CI or deployment config.
- **Development is test-first.** `apps/api` follows Red/Green/Refactor with mandatory security cases (authorization boundaries, auth bypass, mass assignment, rate limiting) and documents every route and DTO with `@nestjs/swagger`. `apps/web` is covered by Playwright e2e specs with their own mandatory security cases.
- **House rules**: Node 24.x, npm ≥ 10, TypeScript throughout, JSDoc on every function, one root Prettier config, per-app ESLint.
- **The limits are fixed numbers**: 500 MB per file; 20 **live** files per meeting (deleted-but-not-purged files do not hold a slot); 20 GB stored per user **including** deleted-but-not-purged files; 30 days between deletion and purge.

## 5. Acceptance criteria

- [ ] **AC-1** A signed-in owner opening `/meetings/<id>` for their own meeting sees that meeting's title, description, date and participants, and its file list — each row showing name, size, type and upload time — or an empty state saying no files have been uploaded yet.
- [ ] **AC-2** Selecting N files at once produces N rows that upload independently; each file appears in the meeting's file list as its own row completes, with no page reload, and is still there after reloading the page.
- [ ] **AC-3** For a file of at least 100 MB, its row reports at least three distinct intermediate percentages between 0 and 100 before completing — a row that sits at 0 until the transfer ends falsifies this.
- [ ] **AC-4** Cancelling an in-flight upload removes its row within 2 seconds, leaves the other rows of the same batch uploading, and stores nothing: after a reload the cancelled file is absent from the list and its bytes are not retrievable.
- [ ] **AC-5** A file larger than 500 MB is rejected with a message stating the 500 MB limit and nothing is stored — including when the upload is sent straight to `apps/api`, bypassing the page.
- [ ] **AC-6** A file whose type is outside the accepted list is rejected with a message naming the accepted types, the other files of the batch keep uploading, and nothing is stored for the rejected file — including when the upload is sent straight to `apps/api`, and including a file whose extension is renamed to an accepted one.
- [ ] **AC-7** An upload into a meeting already holding 20 live files is rejected with a message stating the 20-file limit; deleting one file makes the identical upload succeed immediately afterwards.
- [ ] **AC-8** An upload that would take the owner's stored total past 20 GB is rejected with a message stating the space remaining, where the total counts deleted-but-not-yet-purged files as well as live ones.
- [ ] **AC-9** An upload interrupted by a connection or server failure leaves its row in a failed state naming the reason and offering Retry and Dismiss; Retry re-sends the whole file and can succeed; before that retry, no partial file is listed, downloadable, or counted against either limit.
- [ ] **AC-10** A video or audio file plays inside the meeting page without navigating away; an image or PDF renders inside the page; a file of any other accepted type downloads instead of previewing.
- [ ] **AC-11** Every listed file can be downloaded, and the downloaded bytes are identical to the bytes that were uploaded.
- [ ] **AC-12** Deleting a file removes it from the main list, places it under "Deleted files" with the time remaining before purge and a Restore control, drops the meeting's live-file count by one, and leaves it neither playable nor downloadable while it sits there.
- [ ] **AC-13** Restoring a file from "Deleted files" returns it to the main list, playable and downloadable again, and counting against the 20-file cap again.
- [ ] **AC-14** A file deleted more than 30 days ago is absent from "Deleted files", is not retrievable by any request, and its stored bytes no longer exist — provable by backdating a deleted file's deletion time.
- [ ] **AC-15** A signed-in user who does not own a meeting gets the same not-found answer for that meeting's page, its file list and each of its files as for a meeting id that does not exist: no filename, size, count, type or byte is disclosed, and nothing in the response distinguishes "no such meeting" from "not yours".
- [ ] **AC-16** A signed-out visitor is redirected to `/login` from the meeting page and receives no file content from any file request; a request carrying a missing, malformed or expired token is refused and returns no bytes.
- [ ] **AC-17** A file's bytes are served only to a request that proves the caller owns the meeting: there is no URL — including a direct request to wherever the bytes are kept — that returns a stored file without a valid session for its owner.
- [ ] **AC-18** A file whose name contains HTML or script markup is shown as literal text on the meeting page, and a name containing path separators or traversal sequences never causes a file to be stored or served from outside its own meeting's location.
- [ ] **AC-19** Every meeting row on the dashboard is a link to that meeting's own page: following the row for a meeting the signed-in owner owns lands on `/meetings/<id>` for that meeting, so the page is reachable without typing a URL.

## Asked & assumed

- **Asked** — What may be uploaded, and under what limits? → Recordings, documents and images (`mp4`, `webm`, `mov`, `mp3`, `wav`, `m4a`, `pdf`, `docx`, `txt`, `md`, `png`, `jpg`), 500 MB per file, 20 files per meeting.
- **Asked** — What can the owner do with a file once it is listed? → List plus inline preview and playback: video and audio play in place, images and PDFs render in place, everything else downloads.
- **Asked** — Can the owner remove a file in this iteration? → Yes: soft delete, with permanent deletion 30 days later.
- **Asked** — Where do the upload UI and the file list live? → On a new meeting page at `/meetings/<id>`.
- **Asked** — How does the owner reach a deleted file during those 30 days? → A "Deleted files" section on the meeting page, each entry showing the time left before purge, with a Restore control.
- **Asked** — Do deleted-but-not-purged files hold a slot against the 20-file cap? → No, only live files count.
- **Asked** — Is there a ceiling above the 10 GB a single meeting can hold? → Yes, 20 GB stored in total per user.
- **Asked** — What does the user see when an upload fails partway? → A failed row naming the reason, with Retry (a full restart of that file) and Dismiss. No resume.
- **Assumed** — Only the meeting's owner may reach its files, and there is no sharing of any kind · the repo has no second actor, since participants are plain email strings rather than accounts; if participants ever become accounts, the access scenarios and AC-15 have to be rewritten.
- **Assumed** — The accepted extensions are exactly the twelve listed above · an owner with a `pptx`, `xlsx` or `heic` file has to convert it before uploading.
- **Assumed** — Files may be uploaded to any meeting the owner owns, whatever its date, past meetings included · if uploads should close once a meeting is over, the meeting page needs a read-only state and AC-1 grows a case.
- **Assumed** — Closing the tab or navigating away mid-upload abandons that upload: nothing partial is listed and nothing resumes on return · if uploads should survive navigation, the transfer has to live outside the page.
- **Assumed** — A file sitting in "Deleted files" offers Restore only, and must be restored before it can be played or downloaded again · if trashed files should stay readable, AC-12 loosens.
- **Assumed** — The 20 GB per-user total counts deleted-but-not-purged files, because their bytes are still on disk · counting live files only would let one account hold 20 GB live plus up to 30 days of deleted files on top.
- **Assumed** — The new meeting page is read-only for the meeting's own fields · `apps/api`'s meetings module has no update endpoint, so editing would mean adding one.
- **Assumed** — The dashboard's existing meeting rows become links to the new meeting page · without that link the page is only reachable by typing a URL.
- **Asked** (2026-08-16, `pre-issues` T-2) — the dashboard link sat in In scope and in the assumption above but no criterion promised it, so close-out would have had nothing to prove it against; add one? → Yes, **AC-19**. Every criterion before it is untouched.
