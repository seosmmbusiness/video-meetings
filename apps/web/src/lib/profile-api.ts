import 'server-only';
import { ApiError, extractErrorMessage, getApiBaseUrl } from './auth-api';

export { ApiError };

/**
 * Shape of the caller's own profile as returned by apps/api's `GET`/`PATCH
 * /profile`, matching its `ProfileResponseDto` (D-5). `avatarUpdatedAt` is a
 * `Date` on the API side and arrives here as its JSON string form.
 */
export interface Profile {
  id: string;
  email: string;
  name: string | null;
  hasAvatar: boolean;
  avatarUpdatedAt: string | null;
}

/**
 * Picks what to greet the caller by: their stored name when they have one,
 * their email address when they don't (AC-5). A cleared name arrives as `null`
 * from apps/api, but an all-whitespace one would still be a blank greeting, so
 * it counts as no name here too.
 * @param name - The stored name, or `null` when none is set.
 * @param email - The caller's email address, used as the fallback.
 * @returns The name to render.
 */
export function displayName(name: string | null, email: string): string {
  return name?.trim() ? name : email;
}

/**
 * What apps/api answers a successful `PATCH /profile/password` with: the
 * re-issued access token for the session that made the change, since the
 * change revokes every token the account holds (D-9, D-10).
 */
export interface ChangedPassword {
  accessToken: string;
}

/**
 * Calls a `/profile` endpoint on apps/api with the caller's bearer token and
 * parses the JSON response, keeping the upstream status on the thrown error so
 * a `401` (session gone) stays distinguishable from a `403` (refused) (D-11).
 * @param path - The path under `/profile`, empty for `/profile` itself.
 * @param token - The caller's JWT access token, sent as a bearer token.
 * @param init - Method, headers and body to merge into the request.
 * @returns The parsed body the API answered with.
 * @throws {ApiError} When the response status is not in the 2xx range.
 */
async function requestProfileEndpoint<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}/profile${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      extractErrorMessage(data, response.statusText),
      response.status,
    );
  }

  return data as T;
}

/**
 * Reads the signed-in caller's own profile via `GET /profile`.
 * @param token - The caller's JWT access token, sent as a bearer token.
 * @returns The caller's profile.
 * @throws {ApiError} When the request fails — `401` when the session is gone,
 * `403` when it is refused.
 */
export function getProfile(token: string): Promise<Profile> {
  return requestProfileEndpoint<Profile>('', token);
}

/**
 * Sets the caller's display name via `PATCH /profile`.
 * @param token - The caller's JWT access token, sent as a bearer token.
 * @param name - The name to store; an empty string clears it (AC-4), so it is
 * always sent as a value rather than omitted.
 * @returns The stored profile as the API answers it.
 * @throws {ApiError} When the request fails — `400` carries the API's own
 * refusal message (AC-3).
 */
export function updateProfileName(
  token: string,
  name: string,
): Promise<Profile> {
  return requestProfileEndpoint<Profile>('', token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

/**
 * Changes the caller's password via `PATCH /profile/password`, which answers
 * with a freshly signed token because the change revokes every token the
 * account holds, this one included (D-9).
 *
 * Only `currentPassword` and `newPassword` are sent: the confirmation is a
 * web-side concern and apps/api's `ChangePasswordDto` has no field for it, so
 * sending one would be refused as an unknown property (D-11). Every rule about
 * what the new password may be stays apps/api's, and its refusal is thrown
 * verbatim so the form can show it (AC-12).
 * @param token - The caller's JWT access token, sent as a bearer token.
 * @param currentPassword - The password the account holds today.
 * @param newPassword - The password to store in its place.
 * @returns The re-issued access token, which is the only session the account
 * has left once this resolves.
 * @throws {ApiError} When the request fails — `400` carries apps/api's own
 * rule refusal, `403` a wrong current password (refused, still signed in) and
 * `401` a session that is already gone (D-11).
 */
export async function changeProfilePassword(
  token: string,
  currentPassword: string,
  newPassword: string,
): Promise<string> {
  const changed = await requestProfileEndpoint<ChangedPassword>(
    '/password',
    token,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    },
  );

  return changed.accessToken;
}
