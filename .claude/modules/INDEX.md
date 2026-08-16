# Module docs index

Per-module architecture and function references, split out of the CLAUDE.md files to keep those short. See the root `CLAUDE.md`'s "Module documentation" section for the convention and workflow.

- [apps/api auth module](module-api-auth.md) — `src/auth`: register/login orchestration, JWT issuance/verification, rate limiting. Delegates to `users`/`credentials` via CQRS.
- [apps/api users module](module-api-users.md) — `src/users`: user persistence (Prisma `User` model), exposed via CQRS commands/queries only.
- [apps/api credentials module](module-api-credentials.md) — `src/credentials`: password hashing/verification (bcrypt), incl. timing-safe dummy-hash comparison, exposed via CQRS commands/queries only.
- [apps/api prisma module](module-api-prisma.md) — `src/prisma`: PrismaService/Module, generator/driver-adapter/build gotchas.
- [apps/api meetings module](module-api-meetings.md) — `src/meetings`: create/list/get meetings scoped to owner, plus the JWT auth guard/strategy added in `src/auth` to protect them.
- [apps/api files module](module-api-files.md) — `src/files`: store/list/serve a meeting's files behind an abstract `FileStorage` boundary, owner-scoped, enforcing every upload limit (size/type/count/quota) and soft-delete/restore/purge.
- [apps/web auth pages](module-web-auth.md) — `app/register`, `app/login`, `app/actions/auth.ts`, `lib/auth-api.ts`, `lib/session.ts`: registration/login UI against `apps/api`'s `src/auth`, cookie-based session, and the home page's signed-in state.
- [apps/web meeting page + file proxy](module-web-meeting-files.md) — `app/meetings/[id]`, `app/api/meetings/[meetingId]/files/[fileId]/content`, `lib/files-api.ts`, `lib/api-proxy.ts`: the meeting detail page and its file list/download, proxied same-origin so the session token never reaches the browser.
