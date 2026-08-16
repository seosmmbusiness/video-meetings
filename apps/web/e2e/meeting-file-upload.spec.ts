import { randomBytes, randomUUID } from 'crypto';
import { rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type BrowserContext,
} from '@playwright/test';

// The uploader talks to apps/api through the same-origin proxy, so these
// specs run against a real apps/api + Postgres (see apps/api/CLAUDE.md's
// Database section), like meeting-page.spec.ts.
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3001';
const STRONG_PASSWORD = 'Str0ngPass!';

// Registration itself is throttled per-IP (no credential exists yet to key
// on), and every spec file in this suite shares one loopback IP when run
// together — so this file registers exactly one owner account, in `serial`
// mode, rather than one per test, to avoid tripping that shared bucket.
// The 20-file cap and quota tests below still isolate cleanly since each
// test creates its own meeting under this one owner.
test.describe.configure({ mode: 'serial' });
let ownerToken: string;

/**
 * Builds a fresh, never-before-registered email so tests don't collide with
 * each other or with previous runs against the same database.
 * @returns A unique email address.
 */
function uniqueEmail(): string {
  return `web-e2e-upload-${randomUUID()}@example.com`;
}

/**
 * Registers an account directly against apps/api and returns its access
 * token, bypassing the UI, so tests can seed meetings/files before visiting
 * the page under test.
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
 * can authenticate a page without driving the login form.
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
 * Creates a meeting via apps/api for the given account, dated tomorrow.
 * @param request - Playwright's API request context.
 * @param token - The owner's JWT access token.
 * @param title - The meeting's title.
 * @returns The created meeting's id.
 */
async function createMeeting(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/meetings`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title,
      date: new Date(Date.now() + 86_400_000).toISOString(),
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
 * Uploads a file onto a meeting directly via apps/api, bypassing the page —
 * used to seed the 20-live-file cap (task 5.5, AC-7) without driving the UI
 * 20 times.
 * @param request - Playwright's API request context.
 * @param token - The owner's JWT access token.
 * @param meetingId - The target meeting's id.
 * @param bytes - The file content to upload.
 * @param name - The file name to send.
 */
async function seedFile(
  request: APIRequestContext,
  token: string,
  meetingId: string,
  bytes: Buffer,
  name: string,
): Promise<void> {
  const response = await request.post(
    `${API_BASE_URL}/meetings/${meetingId}/files`,
    {
      headers: { Authorization: `Bearer ${token}` },
      multipart: { file: { name, mimeType: 'text/plain', buffer: bytes } },
    },
  );
  if (!response.ok()) {
    throw new Error(`Fixture file upload failed: ${response.status()}`);
  }
}

/**
 * Writes a valid, silent WAV file of exactly `totalBytes` to the OS temp
 * directory: a 44-byte RIFF/WAVE header (the research's D-11 fixture)
 * followed by zeroed PCM samples. A block of zeros with no such header
 * would be refused by task 2.2's type check before any progress could be
 * observed, which is why this must be a genuinely valid accepted file
 * rather than an arbitrary large blob.
 * @param totalBytes - The exact file size to produce.
 * @returns The absolute path of the written file; the caller removes it.
 */
async function writeSilentWavFixture(totalBytes: number): Promise<string> {
  const dataBytes = totalBytes - 44;
  const buffer = Buffer.alloc(totalBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(44100, 24); // sample rate
  buffer.writeUInt32LE(44100 * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  // Bytes 44.. are left zeroed by Buffer.alloc — silent PCM samples.
  const path = join(tmpdir(), `mfu-progress-${randomUUID()}.wav`);
  await writeFile(path, buffer);
  return path;
}

test.beforeAll(async () => {
  const api = await playwrightRequest.newContext();
  try {
    ({ token: ownerToken } = await registerViaApi(api));
  } finally {
    await api.dispose();
  }
});

test('uploads several selected files independently and they survive a reload (AC-2)', async ({
  page,
  context,
  request,
}) => {
  const meetingId = await createMeeting(request, ownerToken, 'Batch upload');
  await signInAs(context, ownerToken);
  await page.goto(`/meetings/${meetingId}`);

  await page.locator('input[type="file"]').setInputFiles([
    {
      name: 'first.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('first content'),
    },
    {
      name: 'second.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('second content'),
    },
  ]);

  // Each row joins the committed Files list on its own, with no reload —
  // scoped to that list specifically, since the filename is also visible
  // (transiently) in the in-progress Uploads row while it's still sending.
  const filesList = page.getByRole('list', { name: 'Files' });
  await expect(filesList.getByText('first.txt')).toBeVisible({
    timeout: 10_000,
  });
  await expect(filesList.getByText('second.txt')).toBeVisible({
    timeout: 10_000,
  });
  expect(page.url()).toContain(`/meetings/${meetingId}`);

  await page.reload();
  await expect(
    page.getByRole('list', { name: 'Files' }).getByText('first.txt'),
  ).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Files' }).getByText('second.txt'),
  ).toBeVisible();
});

test('reports at least three distinct intermediate upload percentages for a 100 MB file (AC-3)', async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(60_000);
  const meetingId = await createMeeting(request, ownerToken, 'Progress upload');
  await signInAs(context, ownerToken);
  await page.goto(`/meetings/${meetingId}`);

  const wavPath = await writeSilentWavFixture(100 * 1024 * 1024);
  try {
    await page.locator('input[type="file"]').setInputFiles(wavPath);

    const output = page.getByTestId('upload-progress');
    const seen = new Set<number>();
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && seen.size < 3) {
      const text = await output.textContent().catch(() => null);
      const match = text?.match(/(\d+)/);
      if (match) {
        const value = Number(match[1]);
        if (value > 0 && value < 100) seen.add(value);
      }
      if ((await page.getByRole('list', { name: 'Uploads' }).count()) === 0) {
        break; // The row is already gone — the upload finished.
      }
      await page.waitForTimeout(15);
    }

    expect(seen.size).toBeGreaterThanOrEqual(3);
  } finally {
    await rm(wavPath, { force: true });
  }
});

test('cancels one upload without disturbing the batch, and stores nothing (AC-4)', async ({
  page,
  context,
  request,
}) => {
  const meetingId = await createMeeting(request, ownerToken, 'Cancel upload');
  await signInAs(context, ownerToken);
  await page.goto(`/meetings/${meetingId}`);

  // Holds every upload request open for a moment so the click below lands
  // while the cancelled row is still genuinely in flight, rather than
  // racing a near-instant loopback transfer.
  await page.route(`**/api/meetings/${meetingId}/files`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue().catch(() => undefined);
  });

  await page.locator('input[type="file"]').setInputFiles([
    {
      name: 'keep-me.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('kept content'),
    },
    {
      name: 'cancel-me.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('cancelled content'),
    },
  ]);

  const cancelRow = page
    .getByRole('listitem')
    .filter({ hasText: 'cancel-me.txt' });
  await expect(cancelRow).toBeVisible();
  const cancelStartedAt = Date.now();
  await cancelRow.getByRole('button', { name: 'Cancel' }).click();
  await expect(cancelRow).toHaveCount(0);
  expect(Date.now() - cancelStartedAt).toBeLessThan(2000);

  // The other row of the same batch keeps going: its upload row disappears
  // once the transfer finishes, and it lands in the committed files list.
  await expect(
    page.getByRole('list', { name: 'Uploads' }).getByText('keep-me.txt'),
  ).toHaveCount(0, { timeout: 10_000 });
  await expect(
    page.getByRole('list', { name: 'Files' }).getByText('keep-me.txt'),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByText('cancel-me.txt')).toHaveCount(0);
  await expect(page.getByText('keep-me.txt')).toBeVisible();
});

test('fails a broken upload with Retry and Dismiss, and Retry succeeds (AC-9)', async ({
  page,
  context,
  request,
}) => {
  const meetingId = await createMeeting(request, ownerToken, 'Retry upload');
  await signInAs(context, ownerToken);
  await page.goto(`/meetings/${meetingId}`);

  let attempts = 0;
  await page.route(`**/api/meetings/${meetingId}/files`, async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await page.locator('input[type="file"]').setInputFiles({
    name: 'retry-me.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('retry content'),
  });

  const row = page.getByRole('listitem').filter({ hasText: 'retry-me.txt' });
  await expect(row.getByText('Connection failed.')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Dismiss' })).toBeVisible();

  // Nothing is listed while the row sits in the failed state.
  await expect(
    page.getByRole('list', { name: 'Files' }).getByText('retry-me.txt'),
  ).toHaveCount(0);

  await row.getByRole('button', { name: 'Retry' }).click();
  await expect(row).toHaveCount(0, { timeout: 10_000 });

  await page.reload();
  await expect(page.getByText('retry-me.txt')).toBeVisible();
});

test('shows the 500 MB refusal on an oversized file while a normal file in the same batch keeps uploading (AC-5)', async ({
  page,
  context,
  request,
}) => {
  const meetingId = await createMeeting(request, ownerToken, 'Oversize upload');
  await signInAs(context, ownerToken);
  await page.goto(`/meetings/${meetingId}`);

  // A real 500 MB+ fixture isn't necessary: task 5.5 catches this by
  // `file.size` alone, before any request is built, so a spoofed size on an
  // otherwise-empty File exercises the same code path.
  await page.evaluate(() => {
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File(['small content'], 'small.txt', { type: 'text/plain' }),
    );
    const hugeFile = new File([new Uint8Array(1)], 'huge.mp4', {
      type: 'video/mp4',
    });
    Object.defineProperty(hugeFile, 'size', { value: 600_000_000 });
    dataTransfer.items.add(hugeFile);
    input.files = dataTransfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  const hugeRow = page.getByRole('listitem').filter({ hasText: 'huge.mp4' });
  await expect(
    hugeRow.getByText('File exceeds the 500 MB per-file limit.'),
  ).toBeVisible();

  await expect(
    page.getByRole('list', { name: 'Files' }).getByText('small.txt'),
  ).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await expect(page.getByText('small.txt')).toBeVisible();
  await expect(page.getByText('huge.mp4')).toHaveCount(0);
});

test('shows the unsupported-type refusal verbatim while a normal file in the same batch keeps uploading (AC-6)', async ({
  page,
  context,
  request,
}) => {
  const meetingId = await createMeeting(request, ownerToken, 'Bad type upload');
  await signInAs(context, ownerToken);
  await page.goto(`/meetings/${meetingId}`);

  await page.locator('input[type="file"]').setInputFiles([
    {
      name: 'good.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('good content'),
    },
    // Random bytes with no accepted signature and a non-text extension —
    // file-type detects nothing accepted (D-2), so this is refused by type.
    {
      name: 'bad.exe',
      mimeType: 'application/octet-stream',
      buffer: randomBytes(64),
    },
  ]);

  const badRow = page.getByRole('listitem').filter({ hasText: 'bad.exe' });
  await expect(
    badRow.getByText(
      'Unsupported file type. Accepted types: mp4, webm, mov, mp3, wav, m4a, pdf, docx, txt, md, png, jpg.',
    ),
  ).toBeVisible();

  await expect(
    page.getByRole('list', { name: 'Files' }).getByText('good.txt'),
  ).toBeVisible({ timeout: 10_000 });
});

test('shows the 20-file cap refusal verbatim (AC-7)', async ({
  page,
  context,
  request,
}) => {
  const meetingId = await createMeeting(request, ownerToken, 'Full meeting');
  for (let i = 0; i < 20; i += 1) {
    await seedFile(
      request,
      ownerToken,
      meetingId,
      Buffer.from(`seed ${i}`),
      `seed-${i}.txt`,
    );
  }
  await signInAs(context, ownerToken);
  await page.goto(`/meetings/${meetingId}`);

  await page.locator('input[type="file"]').setInputFiles({
    name: 'one-too-many.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('overflow'),
  });

  const row = page
    .getByRole('listitem')
    .filter({ hasText: 'one-too-many.txt' });
  await expect(
    row.getByText(
      'This meeting already holds 20 files. Delete one to upload another.',
    ),
  ).toBeVisible();
});

test('shows the owner-quota refusal verbatim, passed through from the upstream unchanged (AC-8)', async ({
  page,
  context,
  request,
}) => {
  const meetingId = await createMeeting(request, ownerToken, 'Quota upload');
  await signInAs(context, ownerToken);
  await page.goto(`/meetings/${meetingId}`);

  // Actually exhausting a real 20 GB owner quota isn't practical in an e2e
  // run; apps/api's own e2e suite (phase 2) already proves the ceiling
  // itself trips a 507. This test's job is task 5.5's: that whatever the
  // upstream sends is shown on the row verbatim, unchanged by the proxy or
  // the client — so the upstream response is the only thing faked here.
  const quotaMessage = 'Not enough space: 100 MB of the 20 GB total remains.';
  await page.route(`**/api/meetings/${meetingId}/files`, async (route) => {
    await route.fulfill({
      status: 507,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 507, message: quotaMessage }),
    });
  });

  await page.locator('input[type="file"]').setInputFiles({
    name: 'over-quota.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('overflow'),
  });

  const row = page.getByRole('listitem').filter({ hasText: 'over-quota.txt' });
  await expect(row.getByText(quotaMessage)).toBeVisible();
});
