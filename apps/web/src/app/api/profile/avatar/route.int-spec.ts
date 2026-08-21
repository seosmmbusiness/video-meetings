// @vitest-environment node
import { cookies } from 'next/headers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, POST } from './route';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));

const API_BASE_URL = 'http://api.test';
const SESSION_COOKIE_NAME = 'video-meetings.session';
const SESSION_TOKEN = 'session.jwt.token';

// The upstream path the proxy is allowed to reach, verbatim: fixed, with no
// caller-controlled segment at all (AC-17, D-12). Every case that asserts a
// URL asserts this one.
const UPSTREAM_URL = `${API_BASE_URL}/profile/avatar`;

// apps/api's own refusal wording, hand-copied from `profile.constants.ts` on
// purpose: a spec that imported the constant could not catch the two apps
// drifting apart, which is the only failure this assertion exists to catch.
const AVATAR_SIZE_LIMIT_MESSAGE = 'Avatar exceeds the 5 MB limit.';

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
 * Reads the URL and headers of the single upstream call a stub recorded.
 * @param fetchMock - The `fetch` stub returned by {@link mockUpstream}.
 * @returns The requested URL, the request init and its headers.
 */
function upstreamCall(fetchMock: ReturnType<typeof mockUpstream>): {
  url: string;
  init: RequestInit;
  headers: Headers;
} {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init, headers: new Headers(init.headers) };
}

/**
 * The three handlers this route exports, paired with the HTTP method Next
 * calls each of them for, so the cases every method shares run once per
 * method rather than three times over.
 */
const HANDLERS = [
  { method: 'GET', handler: GET },
  { method: 'POST', handler: POST },
  { method: 'DELETE', handler: DELETE },
] as const;

/**
 * Calls one of the route's handlers the way Next does — this route takes no
 * params, so the handler receives the request alone.
 * @param handler - The exported handler under test.
 * @param method - The HTTP method to build the incoming request with.
 * @param init - Extra request init (headers, body) to send as the caller.
 * @param url - The URL the caller requested, defaulting to the route's own.
 * @returns The route's response.
 */
function callRoute(
  handler: (request: Request) => Promise<Response>,
  method: string,
  init: RequestInit = {},
  url = 'http://localhost:3000/api/profile/avatar',
): Promise<Response> {
  return handler(new Request(url, { method, ...init }));
}

describe('/api/profile/avatar', () => {
  beforeEach(() => {
    vi.stubEnv('API_BASE_URL', API_BASE_URL);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  describe.each(HANDLERS)('$method', ({ method, handler }) => {
    it('refuses an unauthenticated caller before opening any upstream request', async () => {
      mockSessionCookie(null);
      const fetchMock = mockUpstream(new Response('bytes'));

      const response = await callRoute(handler, method);

      expect(response.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
      // No body at all: an unauthenticated caller learns nothing about the
      // account whose avatar they asked for.
      await expect(response.text()).resolves.toBe('');
    });

    it("attaches the session's bearer token and never forwards the caller's own Authorization header", async () => {
      mockSessionCookie(SESSION_TOKEN);
      const fetchMock = mockUpstream(new Response(null, { status: 204 }));

      await callRoute(handler, method, {
        headers: {
          Authorization: 'Bearer forged-by-the-caller',
          Cookie: `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`,
          'X-Forwarded-Host': 'attacker.example',
        },
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const { url, init, headers } = upstreamCall(fetchMock);
      expect(url).toBe(UPSTREAM_URL);
      expect(init.method).toBe(method);
      expect(headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
      expect(headers.get('cookie')).toBeNull();
      expect(headers.get('x-forwarded-host')).toBeNull();
    });

    it('reaches the fixed upstream path whatever the caller puts in the URL (AC-17, D-12)', async () => {
      mockSessionCookie(SESSION_TOKEN);
      const fetchMock = mockUpstream(new Response(null, { status: 204 }));

      // The browser appends `?v=<avatarUpdatedAt>` to defeat a cached copy
      // (D-8), and a hostile caller can append anything else. Neither may
      // reach apps/api: the proxy names its own path.
      await callRoute(
        handler,
        method,
        {},
        'http://localhost:3000/api/profile/avatar?v=1699999999999&path=../auth/login',
      );

      expect(upstreamCall(fetchMock).url).toBe(UPSTREAM_URL);
    });
  });

  it('forwards the upload body and its content type upstream (POST)', async () => {
    mockSessionCookie(SESSION_TOKEN);
    const fetchMock = mockUpstream(
      new Response(JSON.stringify({ hasAvatar: true }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await callRoute(POST, 'POST', {
      headers: {
        'content-type': 'multipart/form-data; boundary=----avatar',
        'content-length': '70',
      },
      body: 'ignored-by-the-stub',
      duplex: 'half',
    } as RequestInit);

    const { headers } = upstreamCall(fetchMock);
    expect(headers.get('content-type')).toBe(
      'multipart/form-data; boundary=----avatar',
    );
    expect(headers.get('content-length')).toBe('70');
    expect(response.status).toBe(201);
  });

  it('passes the avatar bytes back with the allow-listed response headers, dropping the rest (GET, D-8)', async () => {
    mockSessionCookie(SESSION_TOKEN);
    mockUpstream(
      new Response('png-bytes', {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': '9',
          'content-disposition': 'inline',
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
          'set-cookie': 'upstream=leaked',
        },
      }),
    );

    const response = await callRoute(GET, 'GET');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-disposition')).toBe('inline');
    // `no-store` is what keeps a removed avatar from being re-painted from a
    // cache (D-8, AC-9), so it has to survive the hop.
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    await expect(response.text()).resolves.toBe('png-bytes');
  });

  it("passes an upstream refusal through unchanged, so the browser sees apps/api's own wording (POST)", async () => {
    mockSessionCookie(SESSION_TOKEN);
    mockUpstream(
      new Response(JSON.stringify({ message: AVATAR_SIZE_LIMIT_MESSAGE }), {
        status: 413,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await callRoute(POST, 'POST');

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      message: AVATAR_SIZE_LIMIT_MESSAGE,
    });
  });

  it('passes a 404 through when the account holds no avatar (GET, AC-9)', async () => {
    mockSessionCookie(SESSION_TOKEN);
    mockUpstream(
      new Response(JSON.stringify({ message: 'Avatar not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await callRoute(GET, 'GET');

    expect(response.status).toBe(404);
  });

  it("passes the removal's own status back (DELETE, AC-9)", async () => {
    mockSessionCookie(SESSION_TOKEN);
    mockUpstream(
      new Response(JSON.stringify({ hasAvatar: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await callRoute(DELETE, 'DELETE');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ hasAvatar: false });
  });

  it('never echoes the session token into anything the browser can read', async () => {
    mockSessionCookie(SESSION_TOKEN);
    mockUpstream(
      new Response('png-bytes', {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    );

    const response = await callRoute(GET, 'GET');

    const headerDump = [...response.headers.entries()].flat().join(' ');
    expect(headerDump).not.toContain(SESSION_TOKEN);
    await expect(response.text()).resolves.not.toContain(SESSION_TOKEN);
  });
});
