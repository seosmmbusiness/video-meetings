import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { THROTTLER_OPTIONS } from '@nestjs/throttler/dist/throttler.constants';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import { AppModule } from '../app.module';
import { DEFAULT_THROTTLE_LIMIT } from './throttler.config';

/**
 * Reads the throttler options the composed application actually resolved.
 * @param moduleRef - The booted testing module.
 * @returns The first (and only) throttler's window and ceiling.
 */
function resolvedThrottler(moduleRef: TestingModule): {
  ttl: unknown;
  limit: unknown;
} {
  const options = moduleRef.get<ThrottlerModuleOptions>(THROTTLER_OPTIONS);
  const throttlers = Array.isArray(options) ? options : options.throttlers;
  return throttlers[0];
}

// The wiring, not the parsing: ConfigModule.forRoot() is what puts the root
// .env into reach, and it has not run while AppModule's metadata is built —
// a throttler registered eagerly would read the default and silently ignore
// every value configured here. Only a booted application proves otherwise.
describe('Global throttler configuration (integration)', () => {
  const original = {
    limit: process.env.THROTTLE_LIMIT,
    ttl: process.env.THROTTLE_TTL_MS,
  };
  let moduleRef: TestingModule | undefined;

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
    if (original.limit === undefined) delete process.env.THROTTLE_LIMIT;
    else process.env.THROTTLE_LIMIT = original.limit;
    if (original.ttl === undefined) delete process.env.THROTTLE_TTL_MS;
    else process.env.THROTTLE_TTL_MS = original.ttl;
  });

  it('carries the configured ceiling into the composed application', async () => {
    process.env.THROTTLE_LIMIT = '137';
    process.env.THROTTLE_TTL_MS = '7000';

    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule],
    }).compile();
    await moduleRef.init();

    expect(resolvedThrottler(moduleRef)).toMatchObject({
      ttl: 7000,
      limit: 137,
    });
  });

  it('keeps the production ceiling when nothing is configured', async () => {
    delete process.env.THROTTLE_LIMIT;
    delete process.env.THROTTLE_TTL_MS;

    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule],
    }).compile();
    await moduleRef.init();

    expect(resolvedThrottler(moduleRef)).toMatchObject({
      limit: DEFAULT_THROTTLE_LIMIT,
    });
  });
});
