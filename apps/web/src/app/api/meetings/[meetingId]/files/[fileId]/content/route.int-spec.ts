// @vitest-environment node
import { cookies } from 'next/headers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));

const API_BASE_URL = 'http://api.test';
const SESSION_COOKIE_NAME = 'video-meetings.session';
const SESSION_TOKEN = 'session.jwt.token';

/**
 * Points the route's session lookup at a given token, or at no session at all.
 * @param token - The token the session cookie holds, or `null` when signed out.
 */
function mockSessionCookie(token: string | null): void {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) =>
      name === SESSION_COOKIE_NAME && token !== null
        ? { name, value: token }
        : undefined,
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

/**
 * Replaces `fetch` with a stub resolving to a fixed upstream response.
 * @param response - What the stubbed upstream answers with.
 * @returns The stub, for asserting how it was called.
 */
function mockUpstream(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * Calls the route the way Next does, with `params` handed over as a Promise.
 * @param init - Request headers to send as the caller.
 * @param ids - The meeting and file ids in the URL.
 * @returns The route's response.
 */
function callRoute(
  init: RequestInit = {},
  ids: { meetingId: string; fileId: string } = {
    meetingId: 'meeting-1',
    fileId: 'file-1',
  },
): Promise<Response> {
  const request = new Request(
    `http://localhost:3000/api/meetings/${ids.meetingId}/files/${ids.fileId}/content`,
    init,
  );
  return GET(request, { params: Promise.resolve(ids) });
}

describe('GET /api/meetings/[meetingId]/files/[fileId]/content', () => {
  beforeEach(() => {
    vi.stubEnv('API_BASE_URL', API_BASE_URL);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it('refuses an unauthenticated caller before opening any upstream request (S-4)', async () => {
    mockSessionCookie(null);
    const fetchMock = mockUpstream(new Response('bytes'));

    const response = await callRoute();

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("attaches the session's bearer token and never forwards the caller's own Authorization header", async () => {
    mockSessionCookie(SESSION_TOKEN);
    const fetchMock = mockUpstream(new Response('bytes'));

    await callRoute({
      headers: {
        Authorization: 'Bearer forged-by-the-caller',
        Range: 'bytes=0-1023',
        Cookie: 'video-meetings.session=session.jwt.token',
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe(`${API_BASE_URL}/meetings/meeting-1/files/file-1/content`);
    expect(headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(headers.get('range')).toBe('bytes=0-1023');
    expect(headers.get('cookie')).toBeNull();
  });

  it('escapes the id segments it interpolates into the upstream path', async () => {
    mockSessionCookie(SESSION_TOKEN);
    const fetchMock = mockUpstream(new Response('bytes'));

    await callRoute({}, { meetingId: '../../auth', fileId: 'a b' });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(
      `${API_BASE_URL}/meetings/..%2F..%2Fauth/files/a%20b/content`,
    );
  });

  it('passes the upstream status and allow-listed response headers back, dropping the rest', async () => {
    mockSessionCookie(SESSION_TOKEN);
    mockUpstream(
      new Response('partial', {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-range': 'bytes 0-1023/4096',
          'accept-ranges': 'bytes',
          'cache-control': 'private, no-store',
          'set-cookie': 'upstream=leaked',
        },
      }),
    );

    const response = await callRoute({ headers: { Range: 'bytes=0-1023' } });

    expect(response.status).toBe(206);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('content-range')).toBe('bytes 0-1023/4096');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it("passes an upstream refusal through unchanged, so the browser sees apps/api's own wording", async () => {
    mockSessionCookie(SESSION_TOKEN);
    mockUpstream(
      new Response(JSON.stringify({ message: 'File not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await callRoute();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      message: 'File not found',
    });
  });
});
