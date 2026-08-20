// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  displayName,
  getProfile,
  updateProfileName,
} from './profile-api';

const API_BASE_URL = 'http://api.test';
const SESSION_TOKEN = 'session.jwt.token';

const PROFILE = {
  id: 'user-1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  hasAvatar: false,
  avatarUpdatedAt: null,
};

/**
 * Replaces `fetch` with a stub resolving to a fixed upstream response, so a
 * case states only what apps/api answered.
 * @param body - The JSON body the upstream answers with, or a raw string for an unparseable one.
 * @param init - The upstream response's status and headers.
 * @returns The stub, for asserting how it was called.
 */
function mockUpstream(body: unknown, init: ResponseInit = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(payload, {
      headers: { 'content-type': 'application/json' },
      ...init,
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * Reads the URL and init of the single `fetch` call a case made.
 * @param fetchMock - The stub returned by {@link mockUpstream}.
 * @returns The requested URL, the request init, and its headers.
 */
function singleCall(fetchMock: ReturnType<typeof mockUpstream>) {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init, headers: new Headers(init.headers) };
}

describe('profile-api', () => {
  beforeEach(() => {
    vi.stubEnv('API_BASE_URL', API_BASE_URL);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  describe('getProfile', () => {
    it("reads GET /profile with the caller's bearer token and no caching", async () => {
      const fetchMock = mockUpstream(PROFILE);

      const profile = await getProfile(SESSION_TOKEN);

      const { url, init, headers } = singleCall(fetchMock);
      expect(url).toBe(`${API_BASE_URL}/profile`);
      expect(headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
      expect(init.cache).toBe('no-store');
      expect(profile).toEqual(PROFILE);
    });

    it("throws an ApiError carrying the API's message and 401 when the session is gone", async () => {
      mockUpstream({ message: 'Unauthorized' }, { status: 401 });

      const error = await getProfile(SESSION_TOKEN).catch((thrown) => thrown);

      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(401);
      expect((error as ApiError).message).toBe('Unauthorized');
    });

    it('keeps 403 distinguishable from 401, so a refusal is not mistaken for a dead session (D-11)', async () => {
      mockUpstream({ message: 'Forbidden' }, { status: 403 });

      const error = await getProfile(SESSION_TOKEN).catch((thrown) => thrown);

      expect((error as ApiError).status).toBe(403);
    });

    it('falls back to the status text when the error body cannot be parsed', async () => {
      mockUpstream('<html>gateway down</html>', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'content-type': 'text/html' },
      });

      const error = await getProfile(SESSION_TOKEN).catch((thrown) => thrown);

      expect((error as ApiError).status).toBe(502);
      expect((error as ApiError).message).toBe('Bad Gateway');
    });
  });

  describe('updateProfileName', () => {
    it('sends the name as JSON to PATCH /profile with the bearer token and no caching', async () => {
      const fetchMock = mockUpstream(PROFILE);

      const profile = await updateProfileName(SESSION_TOKEN, 'Ada Lovelace');

      const { url, init, headers } = singleCall(fetchMock);
      expect(url).toBe(`${API_BASE_URL}/profile`);
      expect(init.method).toBe('PATCH');
      expect(headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
      expect(headers.get('content-type')).toBe('application/json');
      expect(JSON.parse(String(init.body))).toEqual({ name: 'Ada Lovelace' });
      expect(init.cache).toBe('no-store');
      expect(profile).toEqual(PROFILE);
    });

    it("submits an empty name as a value rather than omitting it, since '' is what clears it (AC-4)", async () => {
      const fetchMock = mockUpstream({ ...PROFILE, name: null });

      await updateProfileName(SESSION_TOKEN, '');

      const { init } = singleCall(fetchMock);
      expect(JSON.parse(String(init.body))).toEqual({ name: '' });
    });

    it("joins class-validator's array of messages into one refusal (AC-3)", async () => {
      mockUpstream(
        {
          message: [
            'Name must be 80 characters or fewer.',
            'name must be a string',
          ],
          statusCode: 400,
        },
        { status: 400 },
      );

      const error = await updateProfileName(
        SESSION_TOKEN,
        'x'.repeat(81),
      ).catch((thrown) => thrown);

      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
      expect((error as ApiError).message).toContain(
        'Name must be 80 characters or fewer.',
      );
    });
  });

  describe('displayName', () => {
    it('greets by the stored name when one is set (AC-5)', () => {
      expect(displayName(PROFILE.name, PROFILE.email)).toBe('Ada Lovelace');
    });

    it('falls back to the email when no name is stored', () => {
      expect(displayName(null, PROFILE.email)).toBe(PROFILE.email);
    });

    it("falls back to the email when the name was cleared, since '' is what clears it (AC-4)", () => {
      expect(displayName('', PROFILE.email)).toBe(PROFILE.email);
    });

    it('falls back to the email rather than greeting a blank space', () => {
      expect(displayName('   ', PROFILE.email)).toBe(PROFILE.email);
    });
  });
});
