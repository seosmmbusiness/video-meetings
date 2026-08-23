import { randomUUID } from 'crypto';
import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';

// The profile page requires a session and reads the caller's profile from
// apps/api, so these specs run against a real apps/api + Postgres (see
// apps/api/CLAUDE.md's Database section), like home.spec.ts.
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3001';
const STRONG_PASSWORD = 'Str0ngPass!';

// What the password cases change to. Every one of them registers its own
// account, so this is only ever the second password that account holds.
const NEW_PASSWORD = 'N3wStrongPass';

// apps/api's own refusals (`profile.service.ts` and `ChangePasswordDto`),
// which the form has to show verbatim rather than paraphrase (AC-11, AC-12).
const WRONG_CURRENT_PASSWORD_MESSAGE = 'Current password is incorrect.';
const WEAK_NEW_PASSWORD_MESSAGE =
  'newPassword must contain an uppercase letter, a lowercase letter, and a digit';

// The confirmation is the web's own rule — apps/api has no field for it — so
// this wording belongs to the Server Action (AC-12).
const CONFIRMATION_MISMATCH_MESSAGE =
  'New password and its confirmation do not match.';

// A name that is markup rather than a name (AC-16). The `onerror` payload
// would rename the document if the markup were ever parsed as HTML, and the
// `<img>` would exist in the DOM — neither may happen.
const MARKUP_NAME = `<img src=x onerror="document.title='xss'">`;

// The name the avatar cases store before they start, so the placeholder they
// assert on is deterministic — "AL", not whatever the markup case left behind.
const AVATAR_CASE_NAME = 'Ada Lovelace';
const AVATAR_CASE_INITIALS = 'AL';

// Two real 1×1 PNGs, distinct byte-for-byte, so a replacement can be told
// from what it replaced (AC-6). Inline rather than on disk: apps/api sniffs
// the *content*, so the fixture has to be a genuine PNG, and 70 bytes of it
// is cheaper to keep here than a binary file in the repo.
const PNG_ONE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PNG_TWO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// apps/api's own refusal wording (`profile.constants.ts`), which is what the
// page has to show the user rather than a message of its own (AC-7, AC-8).
const AVATAR_SIZE_LIMIT_MESSAGE = 'Avatar exceeds the 5 MB limit.';
const UNSUPPORTED_AVATAR_TYPE_MESSAGE =
  'Unsupported image type. Accepted types: png, jpg, webp.';

// Registration is throttled per-IP and every spec file in this suite shares one
// loopback IP when run together, so this file registers two accounts in serial
// mode rather than one per test — the same reasoning
// meeting-file-upload.spec.ts and meeting-file-preview.spec.ts already
// document. Two rather than one because the *authenticated* routes are
// throttled per-credential: one account carries the cases that only read the
// profile, the other the cases that rewrite the name, so neither credential's
// own budget is anywhere near the limit either. The password cases are the
// exception and register one account each: a password change revokes every
// token the account holds, so a shared fixture would leave every later case
// signed out. That is affordable because registration rides the *global*
// baseline, which `npm run dev:api:e2e` raises — unlike `/auth/login`, whose
// 10-per-minute override stays put, so only one case calls it.
test.describe.configure({ mode: 'serial' });

/** The account the read-only cases use, and its address; its name is never set. */
let readerToken: string;
let readerEmail: string;
/** The account the name-changing cases rewrite, and its address. */
let writerToken: string;
let writerEmail: string;

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
 * Signs in directly against apps/api, so a case can check which password the
 * account now holds without driving the login page. `/auth/login` keeps its
 * own 10-per-minute limit whatever `THROTTLE_LIMIT` is raised to, so only the
 * case that is about the login outcome may call this.
 * @param request - Playwright's API request context.
 * @param email - The account's email address.
 * @param password - The password to try.
 * @returns The API's own response, so the caller can assert on its status.
 */
function loginViaApi(
  request: APIRequestContext,
  email: string,
  password: string,
) {
  return request.post(`${API_BASE_URL}/auth/login`, {
    data: { email, password },
    failOnStatusCode: false,
  });
}

/**
 * Creates a meeting directly through apps/api, so a case can visit
 * `/meetings/[id]` as a page the account really owns rather than one that
 * would answer not-found whatever the session was.
 * @param request - Playwright's API request context.
 * @param token - The owner's JWT access token.
 * @returns The created meeting's id.
 * @throws {Error} When the fixture meeting creation itself fails.
 */
async function createMeetingViaApi(
  request: APIRequestContext,
  token: string,
): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/meetings`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Revoked session check',
      date: '2030-01-01T10:00:00.000Z',
      participants: [],
    },
  });
  if (!response.ok()) {
    throw new Error(`Fixture meeting creation failed: ${response.status()}`);
  }
  const { id } = (await response.json()) as { id: string };
  return id;
}

/**
 * Drives the profile page's password form: fills the three fields and
 * submits. Each field is filled rather than typed into, so a case can submit
 * twice on one page without carrying the first attempt's values into the
 * second.
 * @param page - The page showing `/profile`.
 * @param currentPassword - The current password as typed.
 * @param newPassword - The new password as typed.
 * @param confirmation - The re-typed new password; the new one by default.
 */
async function changePasswordOnPage(
  page: Page,
  currentPassword: string,
  newPassword: string,
  confirmation: string = newPassword,
): Promise<void> {
  // Exact, so "New password" can't also match "Confirm new password".
  await page
    .getByLabel('Current password', { exact: true })
    .fill(currentPassword);
  await page.getByLabel('New password', { exact: true }).fill(newPassword);
  await page
    .getByLabel('Confirm new password', { exact: true })
    .fill(confirmation);
  await page.getByRole('button', { name: 'Change password' }).click();
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
 * Stores an avatar directly through apps/api's `POST /profile/avatar`, so a
 * case can arrive at the page with an avatar already set without driving the
 * control it is about to test.
 * @param request - Playwright's API request context.
 * @param token - The owner's JWT access token.
 * @param bytes - The image bytes to store.
 * @throws {Error} When the fixture upload call itself fails.
 */
async function setAvatarViaApi(
  request: APIRequestContext,
  token: string,
  bytes: Buffer,
): Promise<void> {
  const response = await request.post(`${API_BASE_URL}/profile/avatar`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      avatar: { name: 'seed.png', mimeType: 'image/png', buffer: bytes },
    },
  });
  if (!response.ok()) {
    throw new Error(`Fixture avatar upload failed: ${response.status()}`);
  }
}

/**
 * Removes any avatar the account holds, directly through apps/api, so a case
 * can start from the placeholder whatever the previous case left behind.
 * @param request - Playwright's API request context.
 * @param token - The owner's JWT access token.
 * @throws {Error} When the fixture removal call itself fails.
 */
async function clearAvatarViaApi(
  request: APIRequestContext,
  token: string,
): Promise<void> {
  const response = await request.delete(`${API_BASE_URL}/profile/avatar`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // `404` is the account simply not holding one — the state this asks for.
  if (!response.ok() && response.status() !== 404) {
    throw new Error(`Fixture avatar removal failed: ${response.status()}`);
  }
}

/**
 * Puts an account into the state the avatar cases all start from: a known
 * name, so the placeholder is deterministic, and no avatar.
 * @param request - Playwright's API request context.
 * @param token - The owner's JWT access token.
 */
async function resetAvatarState(
  request: APIRequestContext,
  token: string,
): Promise<void> {
  await setNameViaApi(request, token, AVATAR_CASE_NAME);
  await clearAvatarViaApi(request, token);
}

/**
 * The avatar mark on whichever page is open — the same component on both
 * `/profile` and `/`, so both are queried the same way.
 * @param page - The page to query.
 * @returns A locator for the avatar mark.
 */
function avatarMark(page: Page) {
  return page.getByLabel('Your avatar');
}

/**
 * Reads the `src` of the avatar image once it has actually rendered.
 * @param page - The page to query.
 * @returns The image's `src` attribute.
 * @throws {Error} When the avatar rendered no image.
 */
async function avatarImageSrc(page: Page): Promise<string> {
  const image = avatarMark(page).locator('img');
  await expect(image).toBeVisible();
  const src = await image.getAttribute('src');
  if (!src) throw new Error('The avatar image carries no src');
  return src;
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

test.beforeAll(async () => {
  const api = await playwrightRequest.newContext();
  try {
    ({ email: readerEmail, token: readerToken } = await registerViaApi(api));
    ({ email: writerEmail, token: writerToken } = await registerViaApi(api));
  } finally {
    await api.dispose();
  }
});

test('redirects a visitor with no session to the login page, carrying no profile data', async ({
  page,
  request,
}) => {
  await setNameViaApi(request, writerToken, 'Ada Lovelace');

  const html = await htmlOf(page, '/profile');

  await expect(page).toHaveURL('/login');
  expect(html).not.toContain(writerEmail);
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
  await setNameViaApi(request, writerToken, 'Ada Lovelace');
  await signInAs(context, unsignedJwt());

  const html = await htmlOf(page, '/profile');

  await expect(page).toHaveURL('/login');
  expect(html).not.toContain(writerEmail);
  expect(html).not.toContain('Ada Lovelace');
});

test('shows the email, the current name and the avatar mark in the first server response', async ({
  page,
  context,
}) => {
  await signInAs(context, readerToken);

  const html = await htmlOf(page, '/profile');

  // AC-1: all of it is in the server's own response, not filled in after
  // hydration — nothing here may flip once JS runs.
  expect(html).toContain(readerEmail);
  expect(html).toContain('Your avatar');
  await expect(page.getByText(readerEmail)).toBeVisible();
  await expect(page.getByLabel('Your avatar')).toBeVisible();
  await expect(page.getByLabel('Display name')).toHaveValue('');
});

test('is reachable from the dashboard', async ({ page, context }) => {
  await signInAs(context, readerToken);

  await page.goto('/');
  await page.getByRole('link', { name: 'Profile' }).click();

  await expect(page).toHaveURL('/profile');
});

test('stores a name with surrounding whitespace removed', async ({
  page,
  context,
  request,
}) => {
  await setNameViaApi(request, writerToken, '');
  await signInAs(context, writerToken);

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
  await setNameViaApi(request, writerToken, 'Ada Lovelace');
  await signInAs(context, writerToken);

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
  await setNameViaApi(request, writerToken, 'Ada Lovelace');
  await signInAs(context, writerToken);

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
  await setNameViaApi(request, writerToken, MARKUP_NAME);
  await signInAs(context, writerToken);

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
  await setNameViaApi(request, writerToken, MARKUP_NAME);
  await signInAs(context, writerToken);

  await page.goto('/');

  await expect(page.getByText(MARKUP_NAME)).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(await page.title()).not.toBe('xss');
});

test('does not leak the session token into the profile page HTML', async ({
  page,
  context,
}) => {
  await signInAs(context, readerToken);

  const html = await htmlOf(page, '/profile');

  expect(html).not.toContain(readerToken);
  expect(await page.content()).not.toContain(readerToken);
});

test('does not leak the session token into the client bundle', async ({
  page,
  context,
  request,
}) => {
  await signInAs(context, readerToken);
  await page.goto('/profile');

  const sources = await page
    .locator('script[src]')
    .evaluateAll((scripts) =>
      scripts.map((script) => (script as HTMLScriptElement).src),
    );
  expect(sources.length).toBeGreaterThan(0);

  for (const source of sources) {
    const response = await request.get(source);
    expect(await response.text()).not.toContain(readerToken);
  }
});

test('shows the uploaded avatar on the profile page and the dashboard without a manual reload (AC-6)', async ({
  page,
  context,
  request,
}) => {
  await resetAvatarState(request, writerToken);
  await signInAs(context, writerToken);

  await page.goto('/profile');
  await expect(avatarMark(page)).toHaveText(AVATAR_CASE_INITIALS);

  await page.getByLabel('Select an avatar image').setInputFiles({
    name: 'me.png',
    mimeType: 'image/png',
    buffer: PNG_ONE,
  });

  // No `page.reload()` anywhere in this case on purpose: the control's own
  // `router.refresh()` is what has to bring the new image in (AC-6).
  const src = await avatarImageSrc(page);
  expect(src).toMatch(/^\/api\/profile\/avatar\?v=\d+$/);

  await page.goto('/');
  await expect(avatarMark(page).locator('img')).toBeVisible();
  await expect(
    page.getByText(`Signed in as ${AVATAR_CASE_NAME}`),
  ).toBeVisible();
});

test('serves the replacement rather than the image it replaced (AC-6)', async ({
  page,
  context,
  request,
}) => {
  await resetAvatarState(request, writerToken);
  await setAvatarViaApi(request, writerToken, PNG_ONE);
  await signInAs(context, writerToken);

  await page.goto('/profile');
  const firstSrc = await avatarImageSrc(page);

  await page.getByLabel('Select an avatar image').setInputFiles({
    name: 'replacement.png',
    mimeType: 'image/png',
    buffer: PNG_TWO,
  });

  // Every change moves the URL, which is what stops a cached copy of the
  // replaced image being painted again (D-8, T-1).
  await expect(avatarMark(page).locator('img')).not.toHaveAttribute(
    'src',
    firstSrc,
  );

  // And what the moved URL serves is the replacement's bytes, not the ones it
  // replaced. `context.request` carries the browser's own session cookie, so
  // this is the same request the <img> makes.
  const served = await context.request.get(
    `http://localhost:3000${await avatarImageSrc(page)}`,
  );
  expect(served.status()).toBe(200);
  expect(Buffer.compare(await served.body(), PNG_TWO)).toBe(0);
});

test('refuses an image over 5 MB with the reason on screen, leaving the stored avatar untouched (AC-7)', async ({
  page,
  context,
  request,
}) => {
  await resetAvatarState(request, writerToken);
  await setAvatarViaApi(request, writerToken, PNG_ONE);
  await signInAs(context, writerToken);

  await page.goto('/profile');
  const src = await avatarImageSrc(page);

  // A real 5 MB-plus fixture isn't necessary: task 4.3 catches this by
  // `file.size` alone, before any request is built, so a spoofed size on an
  // otherwise-tiny File exercises the same code path.
  await page.evaluate(() => {
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const dataTransfer = new DataTransfer();
    const huge = new File([new Uint8Array(1)], 'huge.png', {
      type: 'image/png',
    });
    Object.defineProperty(huge, 'size', { value: 6_000_000 });
    dataTransfer.items.add(huge);
    input.files = dataTransfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(page.getByText(AVATAR_SIZE_LIMIT_MESSAGE)).toBeVisible();

  await page.reload();
  expect(await avatarImageSrc(page)).toBe(src);
});

test('refuses a file renamed to .png whose content is not an image, and stores nothing (AC-8)', async ({
  page,
  context,
  request,
}) => {
  await resetAvatarState(request, writerToken);
  await signInAs(context, writerToken);

  await page.goto('/profile');

  // Declared type and size are both legal, so the browser-side check lets it
  // through by design — only apps/api's content sniffing can refuse it, and
  // its wording is what has to reach the screen.
  await page.getByLabel('Select an avatar image').setInputFiles({
    name: 'not-really.png',
    mimeType: 'image/png',
    buffer: Buffer.from('this is plain text, not a PNG'),
  });

  await expect(page.getByText(UNSUPPORTED_AVATAR_TYPE_MESSAGE)).toBeVisible();

  await page.reload();
  await expect(avatarMark(page)).toHaveText(AVATAR_CASE_INITIALS);
  await expect(avatarMark(page).locator('img')).toHaveCount(0);
});

test('removes the avatar, returning both pages to the placeholder (AC-9)', async ({
  page,
  context,
  request,
}) => {
  await resetAvatarState(request, writerToken);
  await setAvatarViaApi(request, writerToken, PNG_ONE);
  await signInAs(context, writerToken);

  await page.goto('/profile');
  const src = await avatarImageSrc(page);

  await page.getByRole('button', { name: 'Remove avatar' }).click();

  // Again with no reload: the control's own refresh returns the page to the
  // placeholder (AC-9).
  await expect(avatarMark(page).locator('img')).toHaveCount(0);
  await expect(avatarMark(page)).toHaveText(AVATAR_CASE_INITIALS);

  await page.goto('/');
  await expect(avatarMark(page).locator('img')).toHaveCount(0);
  await expect(avatarMark(page)).toHaveText(AVATAR_CASE_INITIALS);

  // The bytes are gone from the server too, not merely unreferenced — the
  // owner's own cached copy is T-1's amendment, the server's answer is not.
  const served = await context.request.get(`http://localhost:3000${src}`);
  expect(served.status()).toBe(404);
});

test('never lets the session token reach the browser on the avatar path (AC-17)', async ({
  page,
  context,
  request,
}) => {
  await resetAvatarState(request, writerToken);
  await signInAs(context, writerToken);

  const leaks: string[] = [];
  page.on('request', (browserRequest) => {
    const headers = JSON.stringify(browserRequest.headers());
    const body = browserRequest.postData() ?? '';
    if (
      browserRequest.url().includes(writerToken) ||
      headers.includes(writerToken) ||
      body.includes(writerToken)
    ) {
      leaks.push(browserRequest.url());
    }
  });

  await page.goto('/profile');
  await page.getByLabel('Select an avatar image').setInputFiles({
    name: 'me.png',
    mimeType: 'image/png',
    buffer: PNG_ONE,
  });
  await avatarImageSrc(page);

  // The proxy attaches the bearer token server-side, so no request the
  // browser makes — the upload, the image, or the refreshed page — may carry
  // it (D-12).
  expect(leaks).toEqual([]);
  expect(await page.content()).not.toContain(writerToken);
});

test('changes the password and keeps the caller signed in, with the new password working at login (AC-10, AC-13)', async ({
  page,
  context,
  request,
}) => {
  const account = await registerViaApi(request);
  await signInAs(context, account.token);

  await page.goto('/profile');
  await changePasswordOnPage(page, STRONG_PASSWORD, NEW_PASSWORD);

  await expect(page.getByText('Password changed.')).toBeVisible();

  // The change revoked every token of this account, including the one this
  // context arrived with — so staying on `/profile` across a reload is only
  // possible because the action wrote the re-issued one into the cookie.
  await page.reload();
  await expect(page).toHaveURL('/profile');

  expect(
    (await loginViaApi(request, account.email, STRONG_PASSWORD)).status(),
  ).toBe(401);
  expect(
    (await loginViaApi(request, account.email, NEW_PASSWORD)).status(),
  ).toBe(200);
});

test('refuses a wrong current password in place, signing nobody out and changing nothing (AC-11)', async ({
  page,
  context,
  request,
}) => {
  const account = await registerViaApi(request);
  await signInAs(context, account.token);

  await page.goto('/profile');
  await changePasswordOnPage(page, 'WrongPass1', NEW_PASSWORD);

  // A 403, not a 401: the refusal is shown on the form and the session is
  // untouched (D-11).
  await expect(page.getByText(WRONG_CURRENT_PASSWORD_MESSAGE)).toBeVisible();
  await expect(page).toHaveURL('/profile');
  await page.reload();
  await expect(page).toHaveURL('/profile');

  // And the stored password is the one it always was — which is what the
  // correct current password still being accepted proves.
  await changePasswordOnPage(page, STRONG_PASSWORD, NEW_PASSWORD);
  await expect(page.getByText('Password changed.')).toBeVisible();
});

test('refuses a new password that breaks the registration rules, naming the rule (AC-12)', async ({
  page,
  context,
  request,
}) => {
  const account = await registerViaApi(request);
  await signInAs(context, account.token);

  await page.goto('/profile');
  await changePasswordOnPage(page, STRONG_PASSWORD, 'weakweak');

  await expect(page.getByText(WEAK_NEW_PASSWORD_MESSAGE)).toBeVisible();
  await expect(page).toHaveURL('/profile');

  // Nothing was changed: the original password still opens the change.
  await changePasswordOnPage(page, STRONG_PASSWORD, NEW_PASSWORD);
  await expect(page.getByText('Password changed.')).toBeVisible();
});

test('refuses a new password that differs from its confirmation, changing nothing (AC-12)', async ({
  page,
  context,
  request,
}) => {
  const account = await registerViaApi(request);
  await signInAs(context, account.token);

  await page.goto('/profile');
  await changePasswordOnPage(page, STRONG_PASSWORD, NEW_PASSWORD, 'N3wOther');

  await expect(page.getByText(CONFIRMATION_MISMATCH_MESSAGE)).toBeVisible();
  await expect(page).toHaveURL('/profile');

  await changePasswordOnPage(page, STRONG_PASSWORD, NEW_PASSWORD);
  await expect(page.getByText('Password changed.')).toBeVisible();
});

test("sends the account's other session to login on its next action (AC-13)", async ({
  page,
  context,
  browser,
  request,
}) => {
  const account = await registerViaApi(request);
  await signInAs(context, account.token);

  // A meeting the account really owns, so the revoked context's visit to
  // `/meetings/[id]` is decided by the session rather than by not-found.
  const meetingId = await createMeetingViaApi(request, account.token);

  // A second browser context holding the same session, the way a second
  // device or a second browser would.
  const otherContext = await browser.newContext();
  try {
    await signInAs(otherContext, account.token);
    const otherPage = await otherContext.newPage();
    await otherPage.goto('/profile');
    await expect(otherPage).toHaveURL('/profile');
    await otherPage.goto(`/meetings/${meetingId}`);
    await expect(otherPage).toHaveURL(`/meetings/${meetingId}`);

    await page.goto('/profile');
    await changePasswordOnPage(page, STRONG_PASSWORD, NEW_PASSWORD);
    await expect(page.getByText('Password changed.')).toBeVisible();

    // The context that made the change carries on without signing in again.
    await page.goto('/');
    await expect(page).toHaveURL('/');

    // The other one is refused on its very next action, wherever it goes:
    // every page that can meet a `401` from apps/api treats it as signed out
    // and redirects before rendering anything of its own (AC-14).
    await otherPage.goto('/profile');
    await expect(otherPage).toHaveURL('/login');
    await otherPage.goto('/');
    await expect(otherPage).toHaveURL('/login');
    await otherPage.goto(`/meetings/${meetingId}`);
    await expect(otherPage).toHaveURL('/login');
    expect(await otherPage.content()).not.toContain('Revoked session check');
  } finally {
    await otherContext.close();
  }
});

test('never carries a password or the session token into a browser-visible response during a change (AC-17)', async ({
  page,
  context,
  request,
}) => {
  const account = await registerViaApi(request);
  await signInAs(context, account.token);

  // Everything the browser is handed while the change happens: the HTML, the
  // action's own RSC payload, and the client bundle it loads.
  const bodies: Promise<string>[] = [];
  page.on('response', (response) => {
    const contentType = response.headers()['content-type'] ?? '';
    if (!/text|javascript|json/.test(contentType)) return;
    bodies.push(response.text().catch(() => ''));
  });

  await page.goto('/profile');
  await changePasswordOnPage(page, STRONG_PASSWORD, NEW_PASSWORD);
  await expect(page.getByText('Password changed.')).toBeVisible();

  const texts = await Promise.all(bodies);
  expect(texts.length).toBeGreaterThan(0);
  for (const text of texts) {
    expect(text).not.toContain(account.token);
    expect(text).not.toContain(STRONG_PASSWORD);
    expect(text).not.toContain(NEW_PASSWORD);
  }

  // Including the re-issued token the change answered with, which the action
  // must put in the cookie rather than return to the page (S-6).
  const rendered = await page.content();
  expect(rendered).not.toContain(NEW_PASSWORD);
  expect(rendered).not.toMatch(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
});
