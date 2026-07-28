# video-meetings

Monorepo (npm workspaces) with two independent apps:

- **apps/web** — [Next.js 16.2.12](https://nextjs.org/docs/app/getting-started/installation) (App Router, TypeScript, ESLint)
- **apps/api** — [NestJS 11.1.28](https://docs.nestjs.com/) (TypeScript, ESLint, Prettier via eslint-plugin-prettier, Jest)

## Requirements

- Node.js `24.x` (see `.nvmrc`)
- npm `>=10`

## Getting started

```bash
npm install
```

## Scripts

| Script              | Description                              |
| -------------------- | ----------------------------------------- |
| `npm run dev:web`    | Start Next.js dev server (apps/web)       |
| `npm run dev:api`    | Start NestJS in watch mode (apps/api)     |
| `npm run build`      | Build both apps                           |
| `npm run build:web`  | Build apps/web only                       |
| `npm run build:api`  | Build apps/api only                       |
| `npm run lint`       | Lint both apps                            |
| `npm run lint:web`   | Lint apps/web only                        |
| `npm run lint:api`   | Lint apps/api only                        |
| `npm run format`     | Format apps/** with Prettier              |
| `npm run format:check` | Check formatting without writing        |
| `npm run test:api`   | Run NestJS unit tests                     |

## Conventions

- TypeScript everywhere.
- A single root `.prettierrc` / `.prettierignore` is shared by both apps for consistent formatting.
- Each app keeps its own ESLint config, since `eslint-config-next` and the NestJS ESLint setup use different rule sets and plugins.
- Node version is pinned via `.nvmrc`.
