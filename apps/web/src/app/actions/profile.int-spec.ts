// @vitest-environment node
import { cookies } from 'next/headers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changePasswordAction, updateNameAction } from './profile';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  refresh: vi.fn(),
}));

const API_BASE_URL = 'http://api.test';
const SESSION_COOKIE_NAME = 'video-meetings.session';
const SESSION_TOKEN = 'session.jwt.token';

// The token apps/api answers a password change with (D-10): a real JWT shape,
// so the S-6 assertion below is looking for something that is actually there
// to be found rather than for a placeholder no regex would match.
const REISSUED_TOKEN = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJzdWIiOiJ1c2VyLTEiLCJlbWFpbCI6ImFkYUBleGFtcGxlLmNvbSIsInZlciI6MX0',
  'not-a-real-signature',
].join('.');

// Anything of the form `<segment>.<segment>.<segment>` — what a leaked token
// looks like in a serialised action state, whatever its claims (S-6).
const JWT_SHAPE = /[\w-]+\.[\w-]+\.[\w-]+/;

const CURRENT_PASSWORD = 'Str0ngPass!';
const NEW_PASSWORD = 'N3wStrongPass';

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
 * @returns The cookie store's write spies, so a case can assert whether the
 * session was rewritten (AC-13) or left alone (D-11).
 */
function mockSessionCookie(token: string | null) {
  const store = {
    get: (name: string) =>
      name === SESSION_COOKIE_NAME && token !== null
        ? { name, value: token }
        : undefined,
    set: vi.fn(),
    delete: vi.fn(),
  };
  vi.mocked(cookies).mockResolvedValue(
    store as unknown as Awaited<ReturnType<typeof cookies>>,
  );
  return store;
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

/**
 * Invokes the password action the way `useActionState` does, with the three
 * fields the form submits.
 * @param fields - The submitted values; each defaults to a valid one, so a
 * case only states the field it is about.
 * @param fields.currentPassword - The current password as typed.
 * @param fields.newPassword - The new password as typed.
 * @param fields.confirmPassword - The new password as re-typed.
 * @returns The action's next state.
 */
function submitPassword(
  fields: {
    currentPassword?: string;
    newPassword?: string;
    confirmPassword?: string;
  } = {},
) {
  const formData = new FormData();
  formData.set('currentPassword', fields.currentPassword ?? CURRENT_PASSWORD);
  formData.set('newPassword', fields.newPassword ?? NEW_PASSWORD);
  formData.set(
    'confirmPassword',
    fields.confirmPassword ?? fields.newPassword ?? NEW_PASSWORD,
  );
  return changePasswordAction(undefined, formData);
}

describe('changePasswordAction', () => {
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
    const fetchMock = mockUpstream({ accessToken: REISSUED_TOKEN });

    const state = await submitPassword();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.ok).toBe(false);
    expect(state.error).toEqual(expect.any(String));
    expect(state.error).not.toBe('');
  });

  it('refuses a new password that differs from its confirmation without reaching apps/api (AC-12)', async () => {
    mockSessionCookie(SESSION_TOKEN);
    const fetchMock = mockUpstream({ accessToken: REISSUED_TOKEN });

    // The gate lives in the action rather than in the browser, so it still
    // holds when JavaScript is off and the form posts straight to it.
    const state = await submitPassword({
      newPassword: NEW_PASSWORD,
      confirmPassword: `${NEW_PASSWORD}x`,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.ok).toBe(false);
    expect(state.error).toMatch(/confirm/i);
  });

  it("submits both passwords to apps/api under the session's bearer token, and no confirmation field", async () => {
    mockSessionCookie(SESSION_TOKEN);
    const fetchMock = mockUpstream({ accessToken: REISSUED_TOKEN });

    const state = await submitPassword();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe(`${API_BASE_URL}/profile/password`);
    expect(init.method).toBe('PATCH');
    expect(headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
    // The confirmation is a web-side concern and apps/api's DTO has no field
    // for it, so sending one would be refused as an unknown property (D-11).
    expect(JSON.parse(String(init.body))).toEqual({
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(state.ok).toBe(true);
  });

  it('keeps the caller signed in by storing the token apps/api answered with (AC-13)', async () => {
    const store = mockSessionCookie(SESSION_TOKEN);
    mockUpstream({ accessToken: REISSUED_TOKEN });

    await submitPassword();

    expect(store.set).toHaveBeenCalledTimes(1);
    const [name, value] = store.set.mock.calls[0] as [string, string];
    expect(name).toBe(SESSION_COOKIE_NAME);
    expect(value).toBe(REISSUED_TOKEN);
    expect(store.delete).not.toHaveBeenCalled();
  });

  it('returns no token in its state, since the state is serialised into the page payload (S-6, AC-17)', async () => {
    mockSessionCookie(SESSION_TOKEN);
    mockUpstream({ accessToken: REISSUED_TOKEN });

    const state = await submitPassword();

    const serialised = JSON.stringify(state);
    expect(serialised).not.toContain(REISSUED_TOKEN);
    expect(serialised).not.toContain(SESSION_TOKEN);
    // Not just this token: nothing token-shaped at all may survive into what
    // the browser is handed.
    expect(serialised).not.toMatch(JWT_SHAPE);
  });

  it('carries neither password back into its state', async () => {
    mockSessionCookie(SESSION_TOKEN);
    mockUpstream({ accessToken: REISSUED_TOKEN });

    const state = await submitPassword();

    const serialised = JSON.stringify(state);
    expect(serialised).not.toContain(CURRENT_PASSWORD);
    expect(serialised).not.toContain(NEW_PASSWORD);
  });

  it('shows a wrong current password in place, signing nobody out (403, D-11, AC-11)', async () => {
    const store = mockSessionCookie(SESSION_TOKEN);
    mockUpstream(
      { message: 'Current password is incorrect.', statusCode: 403 },
      { status: 403 },
    );

    const state = await submitPassword({ currentPassword: 'WrongPass1' });

    expect(state.ok).toBe(false);
    expect(state.error).toContain('Current password is incorrect.');
    // A 403 is a refusal, not a revoked session: the cookie is neither
    // rewritten nor cleared, so the user stays exactly where they were.
    expect(store.set).not.toHaveBeenCalled();
    expect(store.delete).not.toHaveBeenCalled();
  });

  it("returns apps/api's own rule refusal verbatim for a weak new password (400, AC-12)", async () => {
    mockSessionCookie(SESSION_TOKEN);
    mockUpstream(
      {
        message: [
          'newPassword must contain an uppercase letter, a lowercase letter, and a digit',
        ],
        statusCode: 400,
      },
      { status: 400 },
    );

    const state = await submitPassword({ newPassword: 'weakweak' });

    expect(state.ok).toBe(false);
    expect(state.error).toContain(
      'newPassword must contain an uppercase letter, a lowercase letter, and a digit',
    );
  });

  it('says a rate-limited change in words rather than naming an exception class (S-4)', async () => {
    mockSessionCookie(SESSION_TOKEN);
    // What Nest's throttler actually answers, class name and all — the one
    // refusal on this path that was never written for a reader.
    mockUpstream(
      { message: 'ThrottlerException: Too Many Requests', statusCode: 429 },
      { status: 429 },
    );

    const state = await submitPassword();

    expect(state.ok).toBe(false);
    expect(state.error).not.toContain('ThrottlerException');
    expect(state.error).toMatch(/too many/i);
  });

  it('treats a 401 as the session being gone, not as a refused password (D-11)', async () => {
    mockSessionCookie(SESSION_TOKEN);
    mockUpstream({ message: 'Unauthorized', statusCode: 401 }, { status: 401 });

    const state = await submitPassword();

    expect(state.ok).toBe(false);
    expect(state.error).toMatch(/sign in again/i);
  });
});
