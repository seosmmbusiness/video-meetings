import { randomUUID } from 'crypto';
import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
} from '@playwright/test';

// The meeting page reads a meeting and its files from apps/api, so these
// specs run against a real apps/api + Postgres (see apps/api/CLAUDE.md's
// Database section), like home.spec.ts and auth.spec.ts.
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3001';
const STRONG_PASSWORD = 'Str0ngPass!';

/**
 * Builds a fresh, never-before-registered email so tests don't collide with
 * each other or with previous runs against the same database.
 * @returns A unique email address.
 */
function uniqueEmail(): string {
  return `web-e2e-meeting-${randomUUID()}@example.com`;
}

/**
 * Registers an account directly against apps/api and returns its access
 * token, bypassing the UI, so tests can seed meetings/files via the API
 * before visiting the page under test.
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
 * Creates a meeting via apps/api for the given account.
 * @param request - Playwright's API request context.
 * @param token - The owner's JWT access token.
 * @param overrides - Fields to override on the default meeting payload.
 * @returns The created meeting's id.
 */
async function createMeeting(
  request: APIRequestContext,
  token: string,
  overrides: {
    title: string;
    date: string;
    description?: string;
    participants?: string[];
  },
): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/meetings`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { participants: [], ...overrides },
  });
  if (!response.ok()) {
    throw new Error(`Fixture meeting creation failed: ${response.status()}`);
  }
  const { id } = (await response.json()) as { id: string };
  return id;
}

/**
 * Uploads a file onto a meeting directly via apps/api.
 * @param request - Playwright's API request context.
 * @param token - The owner's JWT access token.
 * @param meetingId - The target meeting's id.
 * @param bytes - The file content to upload.
 * @param name - The file name to send.
 * @returns The stored file's id.
 */
async function uploadFile(
  request: APIRequestContext,
  token: string,
  meetingId: string,
  bytes: Buffer,
  name: string,
): Promise<string> {
  const response = await request.post(
    `${API_BASE_URL}/meetings/${meetingId}/files`,
    {
      headers: { Authorization: `Bearer ${token}` },
      multipart: {
        file: { name, mimeType: 'text/plain', buffer: bytes },
      },
    },
  );
  if (!response.ok()) {
    throw new Error(`Fixture file upload failed: ${response.status()}`);
  }
  const { id } = (await response.json()) as { id: string };
  return id;
}

test('redirects an unauthenticated visitor to the login page', async ({
  page,
  request,
}) => {
  const { token } = await registerViaApi(request);
  const meetingId = await createMeeting(request, token, {
    title: 'Sprint planning',
    date: new Date(Date.now() + 86_400_000).toISOString(),
  });

  await page.goto(`/meetings/${meetingId}`);
  await expect(page).toHaveURL('/login');
});

test("answers not-found for a meeting the caller doesn't own, matching a nonexistent id", async ({
  page,
  context,
  request,
}) => {
  const owner = await registerViaApi(request);
  const meetingId = await createMeeting(request, owner.token, {
    title: 'Owner-only strategy sync',
    date: new Date(Date.now() + 86_400_000).toISOString(),
  });

  const stranger = await registerViaApi(request);
  await signInAs(context, stranger.token);

  const response = await page.goto(`/meetings/${meetingId}`);
  expect(response?.status()).toBe(404);
  await expect(page.getByText('Owner-only strategy sync')).toHaveCount(0);

  const nonexistentResponse = await page.goto(`/meetings/${randomUUID()}`);
  expect(nonexistentResponse?.status()).toBe(404);
});

test("shows the meeting's own fields, its files, and downloads bytes identical to what was uploaded", async ({
  page,
  context,
  request,
}) => {
  const { token } = await registerViaApi(request);
  const meetingId = await createMeeting(request, token, {
    title: 'Design review',
    description: 'Review the new onboarding flow',
    date: new Date('2026-09-01T10:00:00.000Z').toISOString(),
    participants: ['alice@example.com', 'bob@example.com'],
  });
  const fileBytes = Buffer.from('the exact bytes that were uploaded');
  await uploadFile(request, token, meetingId, fileBytes, 'notes.txt');
  await signInAs(context, token);

  await page.goto(`/meetings/${meetingId}`);

  await expect(
    page.getByRole('heading', { name: 'Design review' }),
  ).toBeVisible();
  await expect(page.getByText('Review the new onboarding flow')).toBeVisible();
  await expect(page.getByText('alice@example.com')).toBeVisible();
  await expect(page.getByText('bob@example.com')).toBeVisible();

  const fileRow = page.getByRole('listitem').filter({ hasText: 'notes.txt' });
  await expect(fileRow).toBeVisible();
  await expect(fileRow.getByText('text/plain')).toBeVisible();

  const downloadLink = fileRow.getByRole('link', { name: 'Download' });
  const href = await downloadLink.getAttribute('href');
  expect(href).toBeTruthy();

  const downloadResponse = await page.request.get(href!);
  expect(downloadResponse.status()).toBe(200);
  expect(await downloadResponse.body()).toEqual(fileBytes);
  // S-7: the proxied byte response must never be labeled cacheable by a
  // shared cache — private bytes, keyed on a URL a cookie-blind cache can't
  // distinguish between owners.
  const cacheControl = downloadResponse.headers()['cache-control'];
  expect(cacheControl).toContain('private');
  expect(cacheControl).not.toContain('public');
});

test('shows empty-state copy when the meeting has no files', async ({
  page,
  context,
  request,
}) => {
  const { token } = await registerViaApi(request);
  const meetingId = await createMeeting(request, token, {
    title: 'Empty meeting',
    date: new Date(Date.now() + 86_400_000).toISOString(),
  });
  await signInAs(context, token);

  await page.goto(`/meetings/${meetingId}`);

  await expect(
    page.getByText('No files have been uploaded yet.'),
  ).toBeVisible();
});

test('renders a file name containing script markup as literal text (AC-18)', async ({
  page,
  context,
  request,
}) => {
  const { token } = await registerViaApi(request);
  const meetingId = await createMeeting(request, token, {
    title: 'Markup test meeting',
    date: new Date(Date.now() + 86_400_000).toISOString(),
  });
  // No `/` in this name: apps/api's basename() normalization (S-6) would
  // legitimately strip anything before one, which is a separate, correct
  // control — not what this case is testing. This name instead exercises
  // AC-18's own clause: markup rendered as text, not executed.
  const scriptName = "<img src=x onerror='window.__xss=true'>.txt";
  await uploadFile(request, token, meetingId, Buffer.from('x'), scriptName);
  await signInAs(context, token);

  let dialogFired = false;
  page.on('dialog', (dialog) => {
    dialogFired = true;
    void dialog.dismiss();
  });

  await page.goto(`/meetings/${meetingId}`);

  await expect(page.getByText(scriptName)).toBeVisible();
  const xssFlag = await page.evaluate(
    () => (window as unknown as { __xss?: boolean }).__xss,
  );
  expect(xssFlag).toBeUndefined();
  expect(dialogFired).toBe(false);
});

test('links a dashboard meeting row to its own page (AC-19)', async ({
  page,
  context,
  request,
}) => {
  const { token } = await registerViaApi(request);
  const meetingId = await createMeeting(request, token, {
    title: 'Linked from dashboard',
    date: new Date(Date.now() + 86_400_000).toISOString(),
  });
  await signInAs(context, token);

  await page.goto('/');
  await page.getByText('Linked from dashboard').click();

  await expect(page).toHaveURL(`/meetings/${meetingId}`);
});

test('refuses an unauthenticated request at the byte-content proxy, with 401 and no body', async ({
  context,
  request,
}) => {
  const { token } = await registerViaApi(request);
  const meetingId = await createMeeting(request, token, {
    title: 'Proxy auth meeting',
    date: new Date(Date.now() + 86_400_000).toISOString(),
  });
  const fileId = await uploadFile(
    request,
    token,
    meetingId,
    Buffer.from('secret'),
    'secret.txt',
  );

  // No session cookie set on this context at all.
  const response = await context.request.get(
    `http://localhost:3000/api/meetings/${meetingId}/files/${fileId}/content`,
  );
  expect(response.status()).toBe(401);
  expect(await response.body()).toHaveLength(0);
});

test('ignores a caller-supplied Authorization header at the proxy (S-4)', async ({
  context,
  request,
}) => {
  const { token } = await registerViaApi(request);
  const meetingId = await createMeeting(request, token, {
    title: 'Proxy header meeting',
    date: new Date(Date.now() + 86_400_000).toISOString(),
  });
  const fileId = await uploadFile(
    request,
    token,
    meetingId,
    Buffer.from('secret'),
    'secret.txt',
  );

  // No session cookie, but an attacker-supplied Authorization header on the
  // request to the proxy itself — it must change nothing: the proxy never
  // reads it, so this is still an unauthenticated request.
  const response = await context.request.get(
    `http://localhost:3000/api/meetings/${meetingId}/files/${fileId}/content`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(response.status()).toBe(401);
});

test('answers 404 through the proxy for a nonexistent file id', async ({
  context,
  request,
}) => {
  const { token } = await registerViaApi(request);
  const meetingId = await createMeeting(request, token, {
    title: 'Proxy 404 meeting',
    date: new Date(Date.now() + 86_400_000).toISOString(),
  });
  await signInAs(context, token);

  const response = await context.request.get(
    `http://localhost:3000/api/meetings/${meetingId}/files/${randomUUID()}/content`,
  );
  expect(response.status()).toBe(404);
});
