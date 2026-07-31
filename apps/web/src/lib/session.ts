import 'server-only';
import { cookies } from 'next/headers';

const SESSION_COOKIE_NAME = 'video-meetings.session';

/** The signed-in user's session, derived from the JWT stored in the session cookie. */
export interface Session {
  /** The raw JWT access token, as issued by apps/api. */
  token: string;
  /** The token's `email` claim, or `null` if it couldn't be decoded. */
  email: string | null;
}

/**
 * Decodes a JWT's payload segment without verifying its signature. JWT
 * segments are base64url-encoded (`-`/`_`), not standard base64 (`+`/`/`),
 * so this must not use `atob`.
 * @param token - A JWT access token.
 * @returns The decoded payload, or `null` if it can't be parsed.
 */
function decodeTokenPayload(token: string): Record<string, unknown> | null {
  try {
    const payloadSegment = token.split('.')[1];
    if (!payloadSegment) return null;
    return JSON.parse(
      Buffer.from(payloadSegment, 'base64url').toString('utf-8'),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Decodes the `email` claim from a JWT's payload, for display purposes only —
 * the signature is not verified, so this must never be used for
 * authorization decisions.
 * @param token - A JWT access token.
 * @returns The token's `email` claim, or `null` if it can't be parsed.
 */
export function getEmailFromToken(token: string): string | null {
  const payload = decodeTokenPayload(token);
  const email = payload?.email;
  return typeof email === 'string' ? email : null;
}

/**
 * Decodes the `exp` claim from a JWT's payload, so the session cookie's
 * expiry can mirror the token's actual validity window.
 * @param token - A JWT access token.
 * @returns The token's expiry as a `Date`, or `null` if it can't be parsed.
 */
export function getExpiryFromToken(token: string): Date | null {
  const payload = decodeTokenPayload(token);
  const exp = payload?.exp;
  return typeof exp === 'number' ? new Date(exp * 1000) : null;
}

/**
 * Reads the current sign-in session from the `httpOnly` session cookie.
 * Safe to call from Server Components (before the page renders) as well as
 * Server Actions.
 * @returns The current session, or `null` when signed out.
 */
export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return { token, email: getEmailFromToken(token) };
}

/**
 * Sets the session cookie from a freshly issued JWT access token (e.g. after
 * register/login), scoping its expiry to the token's own `exp` claim.
 * @param token - The JWT access token returned by apps/api.
 */
export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: getExpiryFromToken(token) ?? undefined,
  });
}

/**
 * Clears the session cookie, signing the user out.
 */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
