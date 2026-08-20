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
 * Calls a `/profile` endpoint on apps/api with the caller's bearer token and
 * parses the JSON response, keeping the upstream status on the thrown error so
 * a `401` (session gone) stays distinguishable from a `403` (refused) (D-11).
 * @param token - The caller's JWT access token, sent as a bearer token.
 * @param init - Method, headers and body to merge into the request.
 * @returns The parsed profile the API answered with.
 * @throws {ApiError} When the response status is not in the 2xx range.
 */
async function requestProfile(
  token: string,
  init: RequestInit = {},
): Promise<Profile> {
  const response = await fetch(`${getApiBaseUrl()}/profile`, {
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

  return data as Profile;
}

/**
 * Reads the signed-in caller's own profile via `GET /profile`.
 * @param token - The caller's JWT access token, sent as a bearer token.
 * @returns The caller's profile.
 * @throws {ApiError} When the request fails — `401` when the session is gone,
 * `403` when it is refused.
 */
export function getProfile(token: string): Promise<Profile> {
  return requestProfile(token);
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
  return requestProfile(token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}
