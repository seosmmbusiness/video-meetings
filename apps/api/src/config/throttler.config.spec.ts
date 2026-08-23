import {
  DEFAULT_THROTTLE_LIMIT,
  DEFAULT_THROTTLE_TTL_MS,
  throttlerOptionsFromEnv,
  trackerFromRequest,
} from './throttler.config';

describe('throttlerOptionsFromEnv', () => {
  it('falls back to the production ceiling when nothing is configured', () => {
    expect(throttlerOptionsFromEnv({})).toEqual({
      ttl: DEFAULT_THROTTLE_TTL_MS,
      limit: DEFAULT_THROTTLE_LIMIT,
    });
  });

  it('reads both the window and the ceiling from the environment', () => {
    expect(
      throttlerOptionsFromEnv({
        THROTTLE_TTL_MS: '1000',
        THROTTLE_LIMIT: '200',
      }),
    ).toEqual({ ttl: 1000, limit: 200 });
  });

  it('reads either one on its own, defaulting the other', () => {
    expect(throttlerOptionsFromEnv({ THROTTLE_LIMIT: '200' })).toEqual({
      ttl: DEFAULT_THROTTLE_TTL_MS,
      limit: 200,
    });
    expect(throttlerOptionsFromEnv({ THROTTLE_TTL_MS: '1000' })).toEqual({
      ttl: 1000,
      limit: DEFAULT_THROTTLE_LIMIT,
    });
  });

  // A rate limit is a security control, so every unusable value has to land on
  // the default rather than on something permissive: a typo must not silently
  // widen the ceiling, and `0` must not disable the guard outright.
  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['non-numeric', 'many'],
    ['zero', '0'],
    ['negative', '-5'],
    ['fractional', '2.5'],
    ['numeric with a suffix', '20req'],
    ['not finite', 'Infinity'],
  ])('ignores a %s ceiling and keeps the default', (_label, value) => {
    expect(throttlerOptionsFromEnv({ THROTTLE_LIMIT: value })).toEqual({
      ttl: DEFAULT_THROTTLE_TTL_MS,
      limit: DEFAULT_THROTTLE_LIMIT,
    });
    expect(throttlerOptionsFromEnv({ THROTTLE_TTL_MS: value })).toEqual({
      ttl: DEFAULT_THROTTLE_TTL_MS,
      limit: DEFAULT_THROTTLE_LIMIT,
    });
  });

  it('keeps the default ceiling for a value that is not a string', () => {
    expect(
      throttlerOptionsFromEnv({
        THROTTLE_LIMIT: undefined,
        THROTTLE_TTL_MS: undefined,
      }),
    ).toEqual({ ttl: DEFAULT_THROTTLE_TTL_MS, limit: DEFAULT_THROTTLE_LIMIT });
  });
});

describe('trackerFromRequest', () => {
  const TOKEN = 'header.payload.signature';

  it('tracks an anonymous caller by its socket address', () => {
    expect(trackerFromRequest({ headers: {}, ip: '10.0.0.1' })).toBe(
      '10.0.0.1',
    );
  });

  it('never puts the credential itself in the tracker', () => {
    const tracker = trackerFromRequest({
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(tracker).not.toContain(TOKEN);
    expect(tracker).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps two different tokens in two different buckets', () => {
    expect(
      trackerFromRequest({ headers: { authorization: `Bearer ${TOKEN}` } }),
    ).not.toBe(
      trackerFromRequest({ headers: { authorization: 'Bearer other.tok.en' } }),
    );
  });

  // `passport-jwt` matches the scheme case-insensitively with an unanchored
  // `/(\S+)\s+(\S+)/`, so every spelling below authenticates the same token.
  // A tracker keyed on the raw header would hand each of them its own bucket,
  // and a stolen session could then brute-force `PATCH /profile/password`
  // without ever meeting the 10-per-minute ceiling that closes S-4.
  it.each([
    ['lowercase scheme', `bearer ${TOKEN}`],
    ['uppercase scheme', `BEARER ${TOKEN}`],
    ['mixed-case scheme', `BeArEr ${TOKEN}`],
    ['a doubled separator', `Bearer  ${TOKEN}`],
    ['a tab separator', `Bearer\t${TOKEN}`],
    ['leading whitespace', `  Bearer ${TOKEN}`],
    ['trailing whitespace', `Bearer ${TOKEN}  `],
  ])('shares one bucket with %s', (_label, authorization) => {
    expect(trackerFromRequest({ headers: { authorization } })).toBe(
      trackerFromRequest({ headers: { authorization: `Bearer ${TOKEN}` } }),
    );
  });

  it('falls back to the whole header when no bearer token can be read', () => {
    const tracker = trackerFromRequest({
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(tracker).toMatch(/^[0-9a-f]{64}$/);
    expect(tracker).not.toBe(
      trackerFromRequest({
        headers: { authorization: 'Basic b3RoZXI6cGFzcw==' },
      }),
    );
  });

  it('tracks a blank Authorization header by the socket address instead', () => {
    expect(
      trackerFromRequest({ headers: { authorization: '' }, ip: '10.0.0.2' }),
    ).toBe('10.0.0.2');
  });
});
