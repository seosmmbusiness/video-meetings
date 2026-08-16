import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { promisify } from 'util';
import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type BrowserContext,
} from '@playwright/test';

// The page reads a meeting's live and deleted files from apps/api, so these
// specs run against a real apps/api + Postgres (see apps/api/CLAUDE.md's
// Database section), like meeting-page.spec.ts.
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3001';
const STRONG_PASSWORD = 'Str0ngPass!';
const execFileAsync = promisify(execFile);

// Registration is throttled per-IP (D-9) and every spec file in this suite
// shares one loopback IP when run together, so this file registers exactly
// one owner account in serial mode rather than one per test — the same
// reasoning meeting-file-upload.spec.ts already documents.
test.describe.configure({ mode: 'serial' });
let ownerToken: string;

/**
 * Builds a fresh, never-before-registered email so tests don't collide with
 * each other or with previous runs against the same database.
 * @returns A unique email address.
 */
function uniqueEmail(): string {
  return `web-e2e-preview-${randomUUID()}@example.com`;
}

/**
 * Registers an account directly against apps/api and returns its access
 * token, bypassing the UI.
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
 * Uploads a file onto a meeting directly via apps/api, bypassing the page.
 * @param request - Playwright's API request context.
 * @param token - The owner's JWT access token.
 * @param meetingId - The target meeting's id.
 * @param bytes - The file content to upload.
 * @param name - The file name to send.
 * @returns The stored file's id and its detected MIME type.
 */
async function seedFile(
  request: APIRequestContext,
  token: string,
  meetingId: string,
  bytes: Buffer,
  name: string,
): Promise<{ id: string; mimeType: string }> {
  const response = await request.post(
    `${API_BASE_URL}/meetings/${meetingId}/files`,
    {
      headers: { Authorization: `Bearer ${token}` },
      multipart: {
        file: { name, mimeType: 'application/octet-stream', buffer: bytes },
      },
    },
  );
  if (!response.ok()) {
    throw new Error(`Fixture file upload failed: ${response.status()}`);
  }
  const { id, mimeType } = (await response.json()) as {
    id: string;
    mimeType: string;
  };
  return { id, mimeType };
}

/**
 * A minimal but structurally valid PNG: the 8-byte signature, a well-formed
 * `IHDR` chunk and an empty `IDAT` chunk — matches apps/api's own e2e
 * fixture (D-11), so `file-type` detects `image/png`.
 * @returns The PNG bytes.
 */
function pngBytes(): Buffer {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const ihdrChunk = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x0d]),
    Buffer.from('IHDR', 'latin1'),
    Buffer.alloc(13),
  ]);
  const idatChunk = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('IDAT', 'latin1'),
  ]);
  return Buffer.concat([signature, ihdrChunk, idatChunk]);
}

/**
 * A minimal but structurally valid ISO-BMFF `ftyp` box with major brand
 * `isom`, which `file-type` detects as `video/mp4` (D-11).
 * @returns The MP4 bytes.
 */
function mp4Bytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x10]),
    Buffer.from('ftyp', 'ascii'),
    Buffer.from('isom', 'ascii'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
  ]);
}

/** The `%PDF` signature `file-type` detects as `application/pdf` (D-11). */
function pdfBytes(): Buffer {
  return Buffer.from('%PDF-1.4\n');
}

/**
 * A minimal but valid silent WAV: a 44-byte RIFF/WAVE header (D-11), which
 * `file-type` detects as `audio/wav`.
 * @returns The WAV bytes.
 */
function wavBytes(): Buffer {
  const totalBytes = 1000;
  const dataBytes = totalBytes - 44;
  const buffer = Buffer.alloc(totalBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(44100, 24);
  buffer.writeUInt32LE(44100 * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

/**
 * Backdates a soft-deleted file's `deletedAt` directly in Postgres, via
 * `docker compose exec`. AC-14's 30-day horizon can't be reached for real
 * in a test run, and unlike apps/api's own e2e suite (which backdates
 * through an in-process `PrismaService`, D-11), this spec runs as a
 * separate process against a real HTTP apps/api with no such handle — so
 * this reaches the same database the running apps/api itself connects to,
 * the closest equivalent available from outside the process.
 * @param fileId - The soft-deleted file's id.
 * @param deletedAt - The backdated deletion timestamp to write.
 */
async function backdateDeletedAt(
  fileId: string,
  deletedAt: Date,
): Promise<void> {
  const user = process.env.POSTGRES_USER ?? 'video_meetings';
  const db = process.env.POSTGRES_DB ?? 'video_meetings';
  const sql = `UPDATE meeting_files SET "deletedAt" = '${deletedAt.toISOString()}' WHERE id = '${fileId}';`;
  await execFileAsync('docker', [
    'compose',
    'exec',
    '-T',
    'db',
    'psql',
    '-U',
    user,
    '-d',
    db,
    '-c',
    sql,
  ]);
}

test.beforeAll(async () => {
  const api = await playwrightRequest.newContext();
  try {
    ({ token: ownerToken } = await registerViaApi(api));
  } finally {
    await api.dispose();
  }
});

test('plays video and audio inside the meeting page, without navigating away (AC-10)', async ({
  page,
  context,
  request,
}) => {
  const meetingId = await createMeeting(
    request,
    ownerToken,
    'Playback meeting',
  );
  const video = await seedFile(
    request,
    ownerToken,
    meetingId,
    mp4Bytes(),
    'clip.mp4',
  );
  const audio = await seedFile(
    request,
    ownerToken,
    meetingId,
    wavBytes(),
    'sound.wav',
  );
  await signInAs(context, ownerToken);

  await page.goto(`/meetings/${meetingId}`);

  const videoRow = page.getByRole('listitem').filter({ hasText: 'clip.mp4' });
  await videoRow.getByRole('button', { name: 'Preview' }).click();
  const videoElement = videoRow.locator('video');
  await expect(videoElement).toBeVisible();
  await expect(videoElement).toHaveAttribute(
    'src',
    `/api/meetings/${meetingId}/files/${video.id}/content`,
  );

  const audioRow = page.getByRole('listitem').filter({ hasText: 'sound.wav' });
  await audioRow.getByRole('button', { name: 'Preview' }).click();
  const audioElement = audioRow.locator('audio');
  await expect(audioElement).toBeVisible();
  await expect(audioElement).toHaveAttribute(
    'src',
    `/api/meetings/${meetingId}/files/${audio.id}/content`,
  );

  expect(page.url()).toContain(`/meetings/${meetingId}`);
});

test('renders an image and a PDF inside the meeting page (AC-10)', async ({
  page,
  context,
  request,
}) => {
  const meetingId = await createMeeting(
    request,
    ownerToken,
    'Rendering meeting',
  );
  const image = await seedFile(
    request,
    ownerToken,
    meetingId,
    pngBytes(),
    'pic.png',
  );
  const pdf = await seedFile(
    request,
    ownerToken,
    meetingId,
    pdfBytes(),
    'doc.pdf',
  );
  await signInAs(context, ownerToken);

  await page.goto(`/meetings/${meetingId}`);

  const imageRow = page.getByRole('listitem').filter({ hasText: 'pic.png' });
  await imageRow.getByRole('button', { name: 'Preview' }).click();
  await expect(imageRow.locator('img[alt="pic.png"]')).toHaveAttribute(
    'src',
    `/api/meetings/${meetingId}/files/${image.id}/content`,
  );

  const pdfRow = page.getByRole('listitem').filter({ hasText: 'doc.pdf' });
  await pdfRow.getByRole('button', { name: 'Preview' }).click();
  await expect(pdfRow.locator('iframe[title="doc.pdf"]')).toHaveAttribute(
    'src',
    `/api/meetings/${meetingId}/files/${pdf.id}/content`,
  );
});

test('offers no preview for a non-previewable accepted type; it only downloads (AC-10)', async ({
  page,
  context,
  request,
}) => {
  const meetingId = await createMeeting(
    request,
    ownerToken,
    'Download-only meeting',
  );
  await seedFile(
    request,
    ownerToken,
    meetingId,
    Buffer.from('plain text notes'),
    'notes.txt',
  );
  await signInAs(context, ownerToken);

  await page.goto(`/meetings/${meetingId}`);

  const row = page.getByRole('listitem').filter({ hasText: 'notes.txt' });
  await expect(row.getByRole('link', { name: 'Download' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Preview' })).toHaveCount(0);
});

test('deletes a file into "Deleted files", freeing a slot, and it is no longer downloadable (AC-12)', async ({
  page,
  context,
  request,
}) => {
  const meetingId = await createMeeting(request, ownerToken, 'Delete meeting');
  const seeded: { id: string; name: string }[] = [];
  for (let i = 0; i < 20; i += 1) {
    const name = `seed-${i}.txt`;
    const { id } = await seedFile(
      request,
      ownerToken,
      meetingId,
      Buffer.from(`seed ${i}`),
      name,
    );
    seeded.push({ id, name });
  }
  await signInAs(context, ownerToken);

  await page.goto(`/meetings/${meetingId}`);

  // The meeting is already at the 20-file cap.
  const overflow = await request.post(
    `${API_BASE_URL}/meetings/${meetingId}/files`,
    {
      headers: { Authorization: `Bearer ${ownerToken}` },
      multipart: {
        file: {
          name: 'overflow.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('x'),
        },
      },
    },
  );
  expect(overflow.status()).toBe(409);

  const target = seeded[0];
  const row = page.getByRole('listitem').filter({ hasText: target.name });
  await row.getByRole('button', { name: 'Delete' }).click();

  const deletedRow = page
    .getByRole('list', { name: 'Deleted files', exact: true })
    .getByRole('listitem')
    .filter({ hasText: target.name });
  await expect(deletedRow).toBeVisible();
  await expect(deletedRow.getByText(/days? left|Purging today/)).toBeVisible();
  await expect(
    page
      .getByRole('list', { name: 'Files', exact: true })
      .getByText(target.name),
  ).toHaveCount(0);

  const deletedDownload = await request.get(
    `${API_BASE_URL}/meetings/${meetingId}/files/${target.id}/content`,
    { headers: { Authorization: `Bearer ${ownerToken}` } },
  );
  expect(deletedDownload.status()).toBe(404);

  // The freed slot lets the identical upload through.
  const retry = await request.post(
    `${API_BASE_URL}/meetings/${meetingId}/files`,
    {
      headers: { Authorization: `Bearer ${ownerToken}` },
      multipart: {
        file: {
          name: 'overflow.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('x'),
        },
      },
    },
  );
  expect(retry.status()).toBe(201);
});

test('restores a file from "Deleted files" back to the main list, downloadable again (AC-13)', async ({
  page,
  context,
  request,
}) => {
  const meetingId = await createMeeting(request, ownerToken, 'Restore meeting');
  const { id: fileId } = await seedFile(
    request,
    ownerToken,
    meetingId,
    Buffer.from('restore me'),
    'restore-me.txt',
  );
  const deleteResponse = await request.delete(
    `${API_BASE_URL}/meetings/${meetingId}/files/${fileId}`,
    { headers: { Authorization: `Bearer ${ownerToken}` } },
  );
  expect(deleteResponse.status()).toBe(204);
  await signInAs(context, ownerToken);

  await page.goto(`/meetings/${meetingId}`);

  const deletedRow = page
    .getByRole('list', { name: 'Deleted files', exact: true })
    .getByRole('listitem')
    .filter({ hasText: 'restore-me.txt' });
  await expect(deletedRow).toBeVisible();
  await deletedRow.getByRole('button', { name: 'Restore' }).click();

  await expect(
    page
      .getByRole('list', { name: 'Deleted files', exact: true })
      .getByText('restore-me.txt'),
  ).toHaveCount(0);
  const filesRow = page
    .getByRole('list', { name: 'Files', exact: true })
    .getByRole('listitem')
    .filter({ hasText: 'restore-me.txt' });
  await expect(filesRow).toBeVisible();

  const downloadResponse = await request.get(
    `${API_BASE_URL}/meetings/${meetingId}/files/${fileId}/content`,
    { headers: { Authorization: `Bearer ${ownerToken}` } },
  );
  expect(downloadResponse.status()).toBe(200);
});

test('a deletion backdated past 30 days is absent from "Deleted files" entirely (AC-14)', async ({
  page,
  context,
  request,
}) => {
  const meetingId = await createMeeting(
    request,
    ownerToken,
    'Purge horizon meeting',
  );
  const { id: fileId } = await seedFile(
    request,
    ownerToken,
    meetingId,
    Buffer.from('long gone'),
    'expired.txt',
  );
  const deleteResponse = await request.delete(
    `${API_BASE_URL}/meetings/${meetingId}/files/${fileId}`,
    { headers: { Authorization: `Bearer ${ownerToken}` } },
  );
  expect(deleteResponse.status()).toBe(204);

  // 31 days ago — past the 30-day purge horizon, whatever the hourly cron
  // has or hasn't done yet (D-8): the read path filters on the horizon too.
  await backdateDeletedAt(fileId, new Date(Date.now() - 31 * 86_400_000));
  await signInAs(context, ownerToken);

  await page.goto(`/meetings/${meetingId}`);

  await expect(
    page.getByRole('list', { name: 'Deleted files', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText('expired.txt')).toHaveCount(0);
  await expect(page.getByText('Nothing has been deleted.')).toBeVisible();
});
