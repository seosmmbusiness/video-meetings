'use server';

import { revalidatePath } from 'next/cache';
import {
  ApiError,
  changeProfilePassword,
  updateProfileName,
} from '@/lib/profile-api';
import { getSession, setSessionCookie } from '@/lib/session';

/** Result of the profile name Server Action, for use with `useActionState`. */
export interface UpdateNameState {
  /** Whether apps/api stored the submitted name. */
  ok: boolean;
  /** The name as apps/api stored it — normalised and trimmed — on success. */
  name?: string;
  /** apps/api's own refusal message, or a generic one, on failure. */
  error?: string;
}

/** Shown when the action runs without a session, and when the session is gone. */
const SIGNED_OUT_MESSAGE = 'Your session has ended. Please sign in again.';

/**
 * Server Action backing the profile page's name form: stores the submitted
 * display name via apps/api's `PATCH /profile` and re-renders the pages that
 * show it. `getSession()` is the first statement and the signed-out outcome is
 * returned without calling apps/api at all — a Server Action is reachable by a
 * direct POST, not only through the rendered form (S-3, AC-19), exactly as
 * `actions/files.ts` guards.
 *
 * The name is always sent as a value, never omitted: an empty string is how a
 * stored name is cleared (AC-4). Length and character rules stay apps/api's —
 * its refusal is returned verbatim so the page can show it (AC-3) — and the
 * returned state carries the stored name only, never the upstream body or the
 * session token, since it is serialised into the page payload (D-12).
 * @param _prevState - The previous action state (unused; required by `useActionState`).
 * @param formData - The submitted form fields (`name`).
 * @returns The stored name on success, or the refusal to render on failure.
 */
export async function updateNameAction(
  _prevState: UpdateNameState | undefined,
  formData: FormData,
): Promise<UpdateNameState> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: SIGNED_OUT_MESSAGE };
  }

  const name = String(formData.get('name') ?? '');

  try {
    const profile = await updateProfileName(session.token, name);

    // The profile page renders the stored name, and the dashboard greets by
    // it (AC-5) — both are server-rendered, so both need re-rendering.
    revalidatePath('/profile');
    revalidatePath('/');

    return { ok: true, name: profile.name ?? '' };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        ok: false,
        error: error.status === 401 ? SIGNED_OUT_MESSAGE : error.message,
      };
    }

    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

/**
 * Result of the password Server Action, for use with `useActionState`.
 *
 * It carries no token and no password on purpose: an action's return value is
 * serialised into the page payload, where `httpOnly` protects nothing, so a
 * state that held the re-issued token would ship an hour-long credential into
 * the browser (S-6, AC-17).
 */
export interface ChangePasswordState {
  /** Whether apps/api stored the new password. */
  ok: boolean;
  /** apps/api's own refusal message, or a web-side one, on failure. */
  error?: string;
}

/** Shown when the new password and its confirmation differ (AC-12). */
const CONFIRMATION_MISMATCH_MESSAGE =
  'New password and its confirmation do not match.';

/**
 * Shown when apps/api's per-route throttle refuses the change (S-4). It is the
 * one refusal on this path whose own wording is not meant for a reader — Nest
 * answers `ThrottlerException: Too Many Requests`, an exception class name —
 * so this is the single exception to returning apps/api's message verbatim.
 */
const RATE_LIMITED_MESSAGE =
  'Too many password changes. Please try again in a minute.';

/**
 * Server Action backing the profile page's password form: changes the
 * account's password via apps/api's `PATCH /profile/password` behind the
 * current one. `getSession()` is the first statement and the signed-out
 * outcome is returned without calling apps/api at all, since a Server Action
 * is reachable by a direct POST rather than only through the rendered form
 * (S-3, AC-19).
 *
 * The confirmation is checked here rather than in the browser, so the gate
 * still holds with JavaScript disabled and the form posting straight to this
 * action (AC-12). Every other rule stays apps/api's and its refusal is
 * returned verbatim (AC-11, AC-12); a `403` is a wrong current password —
 * refused, still signed in — while a `401` is the session itself being gone,
 * which is the split that keeps a typo from signing anyone out (D-11). A `429`
 * is the other exception: the route's own throttle answers with an exception
 * class name, so it is said in words instead (S-4).
 *
 * On success the caller stays signed in: the change revokes every token the
 * account holds (D-9), so the token apps/api answers with is written straight
 * to the session cookie, whose expiry follows that token's own `exp` (AC-13).
 * It is written, never returned — the state is serialised into the page
 * payload (S-6, AC-17).
 * @param _prevState - The previous action state (unused; required by `useActionState`).
 * @param formData - The submitted fields (`currentPassword`, `newPassword`, `confirmPassword`).
 * @returns The outcome to render — never the token and never either password.
 */
export async function changePasswordAction(
  _prevState: ChangePasswordState | undefined,
  formData: FormData,
): Promise<ChangePasswordState> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: SIGNED_OUT_MESSAGE };
  }

  const currentPassword = String(formData.get('currentPassword') ?? '');
  const newPassword = String(formData.get('newPassword') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');

  if (newPassword !== confirmPassword) {
    return { ok: false, error: CONFIRMATION_MISMATCH_MESSAGE };
  }

  try {
    const accessToken = await changeProfilePassword(
      session.token,
      currentPassword,
      newPassword,
    );

    // The change revoked every token the account holds, this one included, so
    // the cookie has to carry the token apps/api answered with or the very next
    // request from this browser would be refused (D-9, AC-13). The write stays
    // server-side and the token never enters the returned state (S-6, AC-17).
    await setSessionCookie(accessToken);

    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) {
        return { ok: false, error: SIGNED_OUT_MESSAGE };
      }
      if (error.status === 429) {
        return { ok: false, error: RATE_LIMITED_MESSAGE };
      }

      return { ok: false, error: error.message };
    }

    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}
