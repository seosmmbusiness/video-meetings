import { join, resolve } from 'path';

const DEV_DEFAULT_STORAGE_ROOT = join(process.cwd(), '../../.data/uploads');

/**
 * Resolves the absolute storage root from `STORAGE_ROOT`, or a dev-only
 * default under the repo root when it is unset outside production.
 *
 * Reads `process.env` directly rather than `ConfigService`: this is also
 * called from multer's `diskStorage` `destination` callback, which runs
 * outside Nest's DI container (its options are built once, at module
 * import/decoration time — see {@link LocalDiskFileStorage}'s own
 * constructor for the DI-based equivalent used elsewhere).
 * @returns The resolved, absolute storage root path.
 * @throws Error if `STORAGE_ROOT` is unset while `NODE_ENV` is `production`.
 */
export function resolveStorageRoot(): string {
  const configured = process.env.STORAGE_ROOT;
  if (configured) {
    return resolve(configured);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('STORAGE_ROOT must be set outside development');
  }
  return resolve(DEV_DEFAULT_STORAGE_ROOT);
}
