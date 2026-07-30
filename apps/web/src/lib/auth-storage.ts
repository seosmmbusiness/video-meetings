const ACCESS_TOKEN_KEY = 'video-meetings.accessToken';
// Same-tab equivalent of the browser's cross-tab `storage` event, so
// components using `subscribeToAccessTokenChanges` (e.g. via
// useSyncExternalStore) re-render right after a local sign-in/out too.
const ACCESS_TOKEN_CHANGE_EVENT = 'video-meetings:access-token-change';

/**
 * Persists the JWT access token returned by register/login in `localStorage`.
 * @param token - The signed JWT to store.
 */
export function saveAccessToken(token: string): void {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
  window.dispatchEvent(new Event(ACCESS_TOKEN_CHANGE_EVENT));
}

/**
 * Reads the stored JWT access token, if any.
 * @returns The stored token, or `null` when signed out or running on the server.
 */
export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

/**
 * Removes the stored JWT access token, signing the user out locally.
 */
export function clearAccessToken(): void {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.dispatchEvent(new Event(ACCESS_TOKEN_CHANGE_EVENT));
}

/**
 * Subscribes to access-token changes: local sign-in/out in this tab, or the
 * `storage` event fired when another tab changes it. Intended as the
 * `subscribe` argument to `useSyncExternalStore`.
 * @param callback - Invoked whenever the stored token may have changed.
 * @returns An unsubscribe function.
 */
export function subscribeToAccessTokenChanges(
  callback: () => void,
): () => void {
  window.addEventListener('storage', callback);
  window.addEventListener(ACCESS_TOKEN_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(ACCESS_TOKEN_CHANGE_EVENT, callback);
  };
}

/**
 * Decodes the `email` claim from a JWT's payload, for display purposes only —
 * the signature is not verified client-side, so this must never be used for
 * authorization decisions.
 * @param token - A JWT access token, e.g. from {@link getAccessToken}.
 * @returns The token's `email` claim, or `null` if it can't be parsed.
 */
export function getEmailFromToken(token: string): string | null {
  try {
    const payloadSegment = token.split('.')[1];
    if (!payloadSegment) return null;
    const payload = JSON.parse(atob(payloadSegment)) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}
