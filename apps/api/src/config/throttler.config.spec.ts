import {
  DEFAULT_THROTTLE_LIMIT,
  DEFAULT_THROTTLE_TTL_MS,
  throttlerOptionsFromEnv,
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
