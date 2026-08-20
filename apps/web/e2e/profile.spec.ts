import { randomUUID } from 'crypto';
import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';

// The profile page requires a session and reads the caller's profile from
// apps/api, so these specs run against a real apps/api + Postgres (see
// apps/api/CLAUDE.md's Database section), like home.spec.ts.
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3001';
const STRONG_PASSWORD = 'Str0ngPass!';

// A name that is markup rather than a name (AC-16). The `onerror` payload
// would rename the document if the markup were ever parsed as HTML, and the
// `<img>` would exist in the DOM — neither may happen.
const MARKUP_NAME = `<img src=x onerror="document.title='xss'">`;

/**
 * Builds a fresh, never-before-registered email so tests don't collide with
 * each other or with previous runs against the same database.
 * @returns A unique email address.
 */
function uniqueEmail(): string {
  return `web-e2e-profile-${randomUUID()}@example.com`;
}

/**
 * Registers an account directly against apps/api and returns its access
 * token, bypassing the UI, so tests can seed a profile before visiting the
 * page under test.
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
 * Stores a display name directly through apps/api's `PATCH /profile`, so a
 * case can arrive at the page with a name already set without driving the
 * form it is about to test.
 * @param request - Playwright's API request context.
 * @param token - The owner's JWT access token.
 * @param name - The name to store.
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
 * Builds a structurally valid JWT whose signature is nonsense, so the cookie
 * survives client-side decoding but apps/api refuses it — the "invalid or
 * expired session" half of AC-14 that a garbage string can't reach.
 * @returns A well-formed but unsigned JWT.
 */
function unsignedJwt(): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    sub: randomUUID(),
    email: uniqueEmail(),
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  return `${header}.${payload}.not-a-real-signature`;
}

/**
 * Navigates to a path and returns the server's first response body, so a case
 * can assert on what was server-rendered rather than on the hydrated DOM.
 * @param page - The page to navigate.
 * @param path - The path to request.
 * @returns The HTML of the server's first response.
 * @throws {Error} When the navigation produced no response.
 */
async function htmlOf(page: Page, path: string): Promise<string> {
  const response = await page.goto(path);
  if (!response) throw new Error(`No response for ${path}`);
  return response.text();
}

test('redirects a visitor with no session to the login page, carrying no profile data', async ({
  page,
  request,
}) => {
  const { email, token } = await registerViaApi(request);
  await setNameViaApi(request, token, 'Ada Lovelace');

  const html = await htmlOf(page, '/profile');

  await expect(page).toHaveURL('/login');
  expect(html).not.toContain(email);
  expect(html).not.toContain('Ada Lovelace');
});

test('rejects a tampered session cookie by redirecting to login', async ({
  page,
  context,
}) => {
  await signInAs(context, 'not-a-real-jwt');

  await page.goto('/profile');

  await expect(page).toHaveURL('/login');
});

test('rejects a well-formed but unsigned session cookie by redirecting to login', async ({
  page,
  context,
  request,
}) => {
  const { email, token } = await registerViaApi(request);
  await setNameViaApi(request, token, 'Ada Lovelace');
  await signInAs(context, unsignedJwt());

  const html = await htmlOf(page, '/profile');

  await expect(page).toHaveURL('/login');
  expect(html).not.toContain(email);
  expect(html).not.toContain('Ada Lovelace');
});

test('shows the email, the current name and the avatar mark in the first server response', async ({
  page,
  context,
  request,
}) => {
  const { email, token } = await registerViaApi(request);
  await signInAs(context, token);

  const html = await htmlOf(page, '/profile');

  // AC-1: all of it is in the server's own response, not filled in after
  // hydration — nothing here may flip once JS runs.
  expect(html).toContain(email);
  expect(html).toContain('Your avatar');
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByLabel('Your avatar')).toBeVisible();
  await expect(page.getByLabel('Display name')).toHaveValue('');
});

test('is reachable from the dashboard', async ({ page, context, request }) => {
  const { token } = await registerViaApi(request);
  await signInAs(context, token);

  await page.goto('/');
  await page.getByRole('link', { name: 'Profile' }).click();

  await expect(page).toHaveURL('/profile');
});

test('stores a name with surrounding whitespace removed', async ({
  page,
  context,
  request,
}) => {
  const { token } = await registerViaApi(request);
  await signInAs(context, token);

  await page.goto('/profile');
  await page.getByLabel('Display name').fill('  Ada Lovelace  ');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByLabel('Display name')).toHaveValue('Ada Lovelace');

  await page.reload();
  await expect(page.getByLabel('Display name')).toHaveValue('Ada Lovelace');
});

test('refuses a name longer than 80 characters and leaves the stored one unchanged', async ({
  page,
  context,
  request,
}) => {
  const { token } = await registerViaApi(request);
  await setNameViaApi(request, token, 'Ada Lovelace');
  await signInAs(context, token);

  await page.goto('/profile');
  await page.getByLabel('Display name').fill('x'.repeat(81));
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText(/80 characters or fewer/)).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Display name')).toHaveValue('Ada Lovelace');
});

test('clears the name when an empty value is submitted', async ({
  page,
  context,
  request,
}) => {
  const { token } = await registerViaApi(request);
  await setNameViaApi(request, token, 'Ada Lovelace');
  await signInAs(context, token);

  await page.goto('/profile');
  await page.getByLabel('Display name').fill('');
  await page.getByRole('button', { name: 'Save' }).click();

  await page.reload();
  await expect(page.getByLabel('Display name')).toHaveValue('');
});

test('renders a name of markup as text on the profile page', async ({
  page,
  context,
  request,
}) => {
  const { token } = await registerViaApi(request);
  await setNameViaApi(request, token, MARKUP_NAME);
  await signInAs(context, token);

  await page.goto('/profile');

  await expect(page.getByLabel('Display name')).toHaveValue(MARKUP_NAME);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(await page.title()).not.toBe('xss');
});

test('renders a name of markup as text on the dashboard', async ({
  page,
  context,
  request,
}) => {
  const { token } = await registerViaApi(request);
  await setNameViaApi(request, token, MARKUP_NAME);
  await signInAs(context, token);

  await page.goto('/');

  await expect(page.getByText(MARKUP_NAME)).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(await page.title()).not.toBe('xss');
});

test('does not leak the session token into the profile page HTML', async ({
  page,
  context,
  request,
}) => {
  const { token } = await registerViaApi(request);
  await signInAs(context, token);

  const html = await htmlOf(page, '/profile');

  expect(html).not.toContain(token);
  expect(await page.content()).not.toContain(token);
});

test('does not leak the session token into the client bundle', async ({
  page,
  context,
  request,
}) => {
  const { token } = await registerViaApi(request);
  await signInAs(context, token);
  await page.goto('/profile');

  const sources = await page
    .locator('script[src]')
    .evaluateAll((scripts) =>
      scripts.map((script) => (script as HTMLScriptElement).src),
    );
  expect(sources.length).toBeGreaterThan(0);

  for (const source of sources) {
    const response = await request.get(source);
    expect(await response.text()).not.toContain(token);
  }
});
