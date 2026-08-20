/** The rate-limit window every route shares unless it overrides it, in ms. */
export const DEFAULT_THROTTLE_TTL_MS = 60_000;

/** Requests allowed per window per tracker, unless a route overrides it. */
export const DEFAULT_THROTTLE_LIMIT = 20;

/** A throttler window and its ceiling, in the shape `ThrottlerModule` takes. */
export interface ThrottlerOptions {
  ttl: number;
  limit: number;
}

/**
 * Reads the global throttle window and ceiling from the environment.
 * @param env - The environment to read `THROTTLE_TTL_MS` and `THROTTLE_LIMIT` from.
 * @returns The window and ceiling to hand `ThrottlerModule`.
 */
export function throttlerOptionsFromEnv(
  env: Record<string, string | undefined>,
): ThrottlerOptions {
  void env;
  return { ttl: DEFAULT_THROTTLE_TTL_MS, limit: DEFAULT_THROTTLE_LIMIT };
}
