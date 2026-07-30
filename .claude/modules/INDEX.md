# Module docs index

Per-module architecture and function references, split out of the CLAUDE.md files to keep those short. See the root `CLAUDE.md`'s "Module documentation" section for the convention and workflow.

- [apps/api auth module](module-api-auth.md) — `src/auth`: register/login, JWT, timing-safe login, rate limiting.
- [apps/api prisma module](module-api-prisma.md) — `src/prisma`: PrismaService/Module, generator/driver-adapter/build gotchas.
- [apps/api meetings module](module-api-meetings.md) — `src/meetings`: create/list/get meetings scoped to owner, plus the JWT auth guard/strategy added in `src/auth` to protect them.
