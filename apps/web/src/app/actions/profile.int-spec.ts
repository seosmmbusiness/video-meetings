// @vitest-environment node
import { cookies } from 'next/headers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateNameAction } from './profile';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  refresh: vi.fn(),
}));

const API_BASE_URL = 'http://api.test';
const SESSION_COOKIE_NAME = 'video-meetings.session';
const SESSION_TOKEN = 'session.jwt.token';

const PROFILE = {
  id: 'user-1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  hasAvatar: false,
  avatarUpdatedAt: null,
};

/**
 * Points the action's session lookup at a given token, or at no session at
 * all — the direct-POST case S-3 describes, where no form was ever rendered.
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
 * @param body - The JSON body apps/api answers with.
 * @param init - The upstream response's status and headers.
 * @returns The stub, for asserting whether and how it was called.
 */
function mockUpstream(body: unknown, init: ResponseInit = {}) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
      ...init,
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * Invokes the action the way `useActionState` does — previous state first,
 * then the submitted form.
 * @param name - The `name` field's submitted value.
 * @returns The action's next state.
 */
function submitName(name: string) {
  const formData = new FormData();
  formData.set('name', name);
  return updateNameAction(undefined, formData);
}

describe('updateNameAction', () => {
  beforeEach(() => {
    vi.stubEnv('API_BASE_URL', API_BASE_URL);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it('changes nothing and calls apps/api not at all when there is no session (S-3, AC-19)', async () => {
    mockSessionCookie(null);
    const fetchMock = mockUpstream(PROFILE);

    const state = await submitName('Attacker');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.ok).toBe(false);
    expect(state.error).toEqual(expect.any(String));
    expect(state.error).not.toBe('');
  });

  it("submits the name to apps/api under the session's bearer token", async () => {
    mockSessionCookie(SESSION_TOKEN);
    const fetchMock = mockUpstream(PROFILE);

    const state = await submitName('Ada Lovelace');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe(`${API_BASE_URL}/profile`);
    expect(init.method).toBe('PATCH');
    expect(headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Ada Lovelace' });
    expect(state.ok).toBe(true);
  });

  it("sends an empty name through rather than skipping the call, since '' is what clears it (AC-4)", async () => {
    mockSessionCookie(SESSION_TOKEN);
    const fetchMock = mockUpstream({ ...PROFILE, name: null });

    const state = await submitName('');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ name: '' });
    expect(state.ok).toBe(true);
  });

  it("returns apps/api's own refusal verbatim, leaving the stored name alone (AC-3)", async () => {
    mockSessionCookie(SESSION_TOKEN);
    mockUpstream(
      { message: ['Name must be 80 characters or fewer.'], statusCode: 400 },
      { status: 400 },
    );

    const state = await submitName('x'.repeat(81));

    expect(state.ok).toBe(false);
    expect(state.error).toContain('Name must be 80 characters or fewer.');
  });

  it("returns nothing from apps/api's body and no session token, since the state is serialised into the page payload (D-12)", async () => {
    mockSessionCookie(SESSION_TOKEN);
    mockUpstream(PROFILE);

    const state = await submitName('Ada Lovelace');

    const serialised = JSON.stringify(state);
    expect(serialised).not.toContain(SESSION_TOKEN);
    expect(serialised).not.toContain(PROFILE.id);
    expect(serialised).not.toContain(PROFILE.email);
  });
});
