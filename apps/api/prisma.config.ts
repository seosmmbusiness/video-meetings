import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// The repo keeps a single .env at the monorepo root; Prisma CLI commands
// for this app are run with cwd=apps/api, so it's two levels up from here.
config({ path: '../../.env' });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
