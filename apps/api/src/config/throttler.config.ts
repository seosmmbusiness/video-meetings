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
 * Reads one positive whole number out of the environment.
 *
 * Anything unusable — absent, blank, fractional, zero, negative, or carrying a
 * suffix — answers the fallback rather than a permissive value: this feeds a
 * security control, so a typo has to leave the production ceiling standing
 * instead of quietly widening or disabling it.
 * @param raw - The environment value, as read.
 * @param fallback - The value to keep when `raw` is unusable.
 * @returns The configured number, or the fallback.
 */
function positiveIntOr(raw: string | undefined, fallback: number): number {
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  // Number() rather than parseInt(), which would read '20req' as 20.
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) return fallback;
  return value;
}

/**
 * Reads the global throttle window and ceiling from the environment.
 * @param env - The environment to read `THROTTLE_TTL_MS` and `THROTTLE_LIMIT` from.
 * @returns The window and ceiling to hand `ThrottlerModule`.
 */
export function throttlerOptionsFromEnv(
  env: Record<string, string | undefined>,
): ThrottlerOptions {
  return {
    ttl: positiveIntOr(env.THROTTLE_TTL_MS, DEFAULT_THROTTLE_TTL_MS),
    limit: positiveIntOr(env.THROTTLE_LIMIT, DEFAULT_THROTTLE_LIMIT),
  };
}
