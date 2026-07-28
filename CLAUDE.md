# video-meetings

npm-workspaces monorepo with two independent apps. See @README.md for the full script table and setup instructions — don't duplicate it here.

## Layout

- `apps/web` — Next.js 16 frontend (App Router, TypeScript). See `apps/web/CLAUDE.md`.
- `apps/api` — NestJS 11 backend (TypeScript). See `apps/api/CLAUDE.md`.

The two apps are independent (no shared package yet) — each has its own `node_modules`, `tsconfig.json`, and ESLint config, because `eslint-config-next` and the NestJS ESLint setup use different rule sets and can't be merged.

## Conventions

- Node `24.x` (`.nvmrc`), npm `>=10`.
- TypeScript everywhere.
- Formatting is centralized: the root `.prettierrc` / `.prettierignore` applies to both apps (`npm run format` / `format:check` from root). Linting is per-app (`npm run lint:web`, `npm run lint:api`).
- Run app-scoped commands via the root `dev:web` / `dev:api` / `build:web` / `build:api` scripts, or `cd` into the app and use its own scripts directly — both work.

## Documentation maintenance

When a change affects project architecture (new app/package, new shared library, new service/database, changed layout, new CI/deployment pipeline, etc.), update the relevant docs in the same change:

- This root `CLAUDE.md` — layout, conventions, status.
- `apps/web/CLAUDE.md` / `apps/api/CLAUDE.md` — when the change is app-specific.
- `README.md` — when scripts, setup steps, or requirements change.

Don't let docs drift from the code; treat doc updates as part of the task, not a follow-up.

## Status

Freshly scaffolded (2026-07-28) from `create-next-app` and `nest new` — no shared libs, auth, database, CI, or deployment config yet. Update this file as real architecture emerges instead of letting it go stale.
