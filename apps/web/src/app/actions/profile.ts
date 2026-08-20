'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, updateProfileName } from '@/lib/profile-api';
import { getSession } from '@/lib/session';

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
