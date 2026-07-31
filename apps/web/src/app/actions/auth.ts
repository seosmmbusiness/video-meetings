'use server';

import { redirect } from 'next/navigation';
import { ApiError, loginAccount, registerAccount } from '@/lib/auth-api';
import { clearSessionCookie, setSessionCookie } from '@/lib/session';

/** Result of a register/login Server Action, for use with `useActionState`. */
export interface AuthFormState {
  /** A human-readable error message, or `null` if the last submission succeeded. */
  error: string | null;
}

/**
 * Server Action backing the registration form: validates the password
 * confirmation, registers the account via apps/api, stores the returned JWT
 * in the session cookie, and redirects to the home page on success.
 * @param _prevState - The previous action state (unused; required by `useActionState`).
 * @param formData - The submitted form fields (`email`, `password`, `confirmPassword`, `consentToTerms`).
 * @returns The next action state on failure; on success this redirects and never returns.
 */
export async function registerAction(
  _prevState: AuthFormState | undefined,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');
  const consentToTerms = formData.get('consentToTerms') === 'on';

  if (password !== confirmPassword) {
    return { error: 'Passwords do not match.' };
  }

  try {
    const { accessToken } = await registerAccount({
      email,
      password,
      consentToTerms,
    });
    await setSessionCookie(accessToken);
  } catch (error) {
    return {
      error:
        error instanceof ApiError
          ? error.message
          : 'Something went wrong. Please try again.',
    };
  }

  redirect('/');
}

/**
 * Server Action backing the login form: authenticates via apps/api, stores
 * the returned JWT in the session cookie, and redirects to the home page on
 * success.
 * @param _prevState - The previous action state (unused; required by `useActionState`).
 * @param formData - The submitted form fields (`email`, `password`).
 * @returns The next action state on failure; on success this redirects and never returns.
 */
export async function loginAction(
  _prevState: AuthFormState | undefined,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  try {
    const { accessToken } = await loginAccount({ email, password });
    await setSessionCookie(accessToken);
  } catch (error) {
    return {
      error:
        error instanceof ApiError
          ? error.message
          : 'Something went wrong. Please try again.',
    };
  }

  redirect('/');
}

/**
 * Server Action backing the home page's sign-out form: clears the session
 * cookie. Next.js re-renders the current page automatically since a cookie
 * changed, so no redirect is needed. Takes no parameters of its own — a
 * `<form action>` calls it with the submitted `FormData`, which this ignores.
 */
export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
}
