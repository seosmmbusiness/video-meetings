import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for apps/web's unit (`*.spec.ts(x)`) and integration
 * (`*.int-spec.ts(x)`) tiers. Playwright owns `e2e/` and is untouched by this
 * config — `include` never leaves `src/`.
 *
 * `environment` defaults to `jsdom` for component tests; a spec that needs
 * real Node globals (Route Handlers, `Request`/`Response`, `fetch`) opts out
 * per file with a `// @vitest-environment node` docblock.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.spec.{ts,tsx}', 'src/**/*.int-spec.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` throws on import unless the resolver applies React's
      // `react-server` condition, which Vitest doesn't (and shouldn't —
      // it would swap React itself for its server build). Every server-side
      // module under src/lib imports it, so specs get an inert stand-in.
      'server-only': fileURLToPath(
        new URL('./test/stubs/server-only.ts', import.meta.url),
      ),
    },
  },
});
