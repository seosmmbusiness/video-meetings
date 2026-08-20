import { randomUUID } from 'crypto';
import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
} from '@playwright/test';

// The home page now requires a session and fetches the caller's meetings
// from apps/api, so these specs run against a real apps/api + Postgres (see
// apps/api/CLAUDE.md's Database section), like auth.spec.ts.
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3001';
const STRONG_PASSWORD = 'Str0ngPass!';

/**
 * Builds a fresh, never-before-registered email so tests don't collide with
 * each other or with previous runs against the same database.
 * @returns A unique email address.
 */
function uniqueEmail(): string {
  return `web-e2e-home-${randomUUID()}@example.com`;
}

/**
 * Registers an account directly against apps/api and returns its access
 * token, bypassing the UI, so tests can seed meetings via the API before
 * visiting the page under test.
 * @param request - Playwright's API request context.
 * @returns The new account's email and JWT access token.
 * @throws {Error} When the fixture registration call itself fails.
 */
async function registerViaApi(
  request: APIRequestContext,
): Promise<{ email: string; token: string }> {
  const email = uniqueEmail();
  const response = await request.post(`${API_BASE_URL}/auth/register`, {
    data: { email, password: STRONG_PASSWORD, consentToTerms: true },
  });
  if (!response.ok()) {
    throw new Error(
      `Fixture registration for ${email} failed: ${response.status()}`,
    );
  }
  const { accessToken } = (await response.json()) as { accessToken: string };
  return { email, token: accessToken };
}

/**
 * Sets the `httpOnly` session cookie directly on a browser context, so tests
 * can authenticate a page without driving the login form — mirroring how
 * `app/actions/auth.ts`'s `setSessionCookie` stores a JWT after a real
 * register/login call.
 * @param context - The browser context to authenticate.
 * @param token - The JWT access token to store.
 */
async function signInAs(context: BrowserContext, token: string): Promise<void> {
  await context.addCookies([
    {
      name: 'video-meetings.session',
      value: token,
      url: 'http://localhost:3000',
      httpOnly: true,
    },
  ]);
}

/**
 * Stores (or clears) a display name directly through apps/api's
 * `PATCH /profile`, so a case can arrive at the dashboard with a name already
 * set without driving the profile form.
 * @param request - Playwright's API request context.
 * @param token - The owner's JWT access token.
 * @param name - The name to store; `''` clears it.
 * @throws {Error} When the fixture update call itself fails.
 */
async function setNameViaApi(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<void> {
  const response = await request.patch(`${API_BASE_URL}/profile`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  if (!response.ok()) {
    throw new Error(`Fixture name update failed: ${response.status()}`);
  }
}

/**
 * Creates a meeting via apps/api for the given account.
 * @param request - Playwright's API request context.
 * @param token - The owner's JWT access token.
 * @param overrides - Fields to override on the default meeting payload.
 */
async function createMeeting(
  request: APIRequestContext,
  token: string,
  overrides: { title: string; date: string; participants?: string[] },
): Promise<void> {
  const response = await request.post(`${API_BASE_URL}/meetings`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { participants: [], ...overrides },
  });
  if (!response.ok()) {
    throw new Error(`Fixture meeting creation failed: ${response.status()}`);
  }
}

test('redirects an unauthenticated visitor to the login page', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL('/login');
});

test('rejects a tampered session cookie by redirecting to login', async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: 'video-meetings.session',
      value: 'not-a-real-jwt',
      url: 'http://localhost:3000',
      httpOnly: true,
    },
  ]);

  await page.goto('/');
  await expect(page).toHaveURL('/login');
});

test('shows the signed-in email and sign-out control', async ({
  page,
  context,
  request,
}) => {
  const { email, token } = await registerViaApi(request);
  await signInAs(context, token);

  await page.goto('/');

  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
});

test('greets the user by name when one is set', async ({
  page,
  context,
  request,
}) => {
  const { email, token } = await registerViaApi(request);
  await setNameViaApi(request, token, 'Ada Lovelace');
  await signInAs(context, token);

  const response = await page.goto('/');
  const html = await response!.text();

  // AC-5: the name is in the server's own HTML, so there is no moment where
  // the email is shown and then replaced once JS runs.
  expect(html).toContain('Ada Lovelace');
  await expect(page.getByText('Ada Lovelace')).toBeVisible();
  await expect(page.getByText(`Signed in as ${email}`)).toHaveCount(0);
});

test('falls back to the email when the name is cleared', async ({
  page,
  context,
  request,
}) => {
  const { email, token } = await registerViaApi(request);
  await setNameViaApi(request, token, 'Ada Lovelace');
  await setNameViaApi(request, token, '');
  await signInAs(context, token);

  const response = await page.goto('/');
  const html = await response!.text();

  expect(html).toContain(email);
  expect(html).not.toContain('Ada Lovelace');
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
});

test('splits meetings into upcoming and the three most recent past meetings', async ({
  page,
  context,
  request,
}) => {
  const { token } = await registerViaApi(request);
  await signInAs(context, token);
  const now = Date.now();
  const day = 24 * 3600 * 1000;

  await createMeeting(request, token, {
    title: 'Design review',
    date: new Date(now + 5 * day).toISOString(),
  });
  await createMeeting(request, token, {
    title: 'Sprint planning',
    date: new Date(now + 2 * day).toISOString(),
  });
  await createMeeting(request, token, {
    title: 'Retro (most recent)',
    date: new Date(now - 1 * day).toISOString(),
  });
  await createMeeting(request, token, {
    title: 'Standup (2nd most recent)',
    date: new Date(now - 2 * day).toISOString(),
  });
  await createMeeting(request, token, {
    title: 'Onboarding (3rd most recent)',
    date: new Date(now - 3 * day).toISOString(),
  });
  await createMeeting(request, token, {
    title: 'Old kickoff (should be cut off)',
    date: new Date(now - 10 * day).toISOString(),
  });

  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'Upcoming meetings' }),
  ).toBeVisible();
  await expect(page.getByText('Sprint planning')).toBeVisible();
  await expect(page.getByText('Design review')).toBeVisible();

  await expect(
    page.getByRole('heading', { name: 'Recent meetings' }),
  ).toBeVisible();
  await expect(page.getByText('Retro (most recent)')).toBeVisible();
  await expect(page.getByText('Standup (2nd most recent)')).toBeVisible();
  await expect(page.getByText('Onboarding (3rd most recent)')).toBeVisible();
  await expect(
    page.getByText('Old kickoff (should be cut off)'),
  ).not.toBeVisible();
});

test('shows empty-state copy when the account has no meetings', async ({
  page,
  context,
  request,
}) => {
  const { token } = await registerViaApi(request);
  await signInAs(context, token);
  await page.goto('/');

  await expect(page.getByText('No upcoming meetings yet.')).toBeVisible();
  await expect(page.getByText('No past meetings yet.')).toBeVisible();
});

test('does not leak the session token into the rendered page', async ({
  page,
  context,
  request,
}) => {
  const { token } = await registerViaApi(request);
  await signInAs(context, token);
  await page.goto('/');

  const content = await page.content();
  expect(content).not.toContain(token);
});
