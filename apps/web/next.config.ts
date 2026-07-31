import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// apps/web has no .env of its own — this repo uses a single root .env
// (see root CLAUDE.md), which apps/api reaches via its own two-levels-up
// path. Next.js only auto-loads .env files from this app's own directory,
// so load the root one explicitly before the config (and anything reading
// process.env at runtime) is evaluated. `forceReload: true` is required:
// Next.js already calls `loadEnvConfig` once internally for this app's own
// (nonexistent) .env before next.config.ts runs, and @next/env caches that
// result at module scope — without forceReload, this second call silently
// no-ops instead of loading the root .env.
loadEnvConfig(
  path.join(__dirname, '..', '..'),
  process.env.NODE_ENV !== 'production',
  undefined,
  true,
);

const nextConfig: NextConfig = {
  /* config options here */

  experimental: {
    inlineCss: true,
  },
};

export default nextConfig;
