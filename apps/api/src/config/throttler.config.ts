import { createHash } from 'node:crypto';

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

/** The minimum a throttled request has to carry for {@link trackerFromRequest}. */
export interface TrackedRequest {
  headers: { authorization?: string };
  ip?: string;
}

/**
 * The bearer token inside an `Authorization` header, read the way
 * `passport-jwt` reads it: an unanchored `/(\S+)\s+(\S+)/` whose scheme is
 * compared case-insensitively.
 */
const BEARER_TOKEN = /(?:^|\s)bearer\s+(\S+)/i;

/**
 * Keys a request's rate-limit bucket by the credential it carries.
 *
 * The bucket follows the **token**, not the header it arrived in. Every
 * spelling `passport-jwt` accepts — `bearer`, `BEARER`, a doubled space, a tab
 * — authenticates the same session, so hashing the raw header would hand one
 * caller an unbounded supply of buckets and leave `/auth/login` and
 * `PATCH /profile/password` unthrottled behind a single stolen token.
 *
 * Tracked by credential rather than by socket: `apps/web` calls this API
 * server-to-server, so every user's traffic would otherwise share one IP
 * bucket behind that proxy. The token is hashed rather than stored, keeping
 * the credential itself out of throttler storage and logs.
 * @param req - The incoming request, read for its `Authorization` header.
 * @returns The bucket key: a hash of the caller's credential, or its address.
 */
export function trackerFromRequest(req: TrackedRequest): string {
  const { authorization } = req.headers;
  if (!authorization) return String(req.ip);
  // A non-bearer header still keys its own bucket — it identifies a caller
  // even when this app cannot authenticate it.
  const credential = BEARER_TOKEN.exec(authorization)?.[1] ?? authorization;
  return createHash('sha256').update(credential).digest('hex');
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
