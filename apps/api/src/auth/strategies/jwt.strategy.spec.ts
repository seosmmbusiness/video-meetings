import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryBus } from '@nestjs/cqrs';
import type { User } from '../../../generated/prisma/client';
import { FindUserByIdQuery } from '../../users/queries/find-user-by-id.query';
import { JwtPayload, JwtStrategy } from './jwt.strategy';

/**
 * Builds a full Prisma `User` row, so the strategy is exercised against the
 * same shape `FindUserByIdQuery` really answers with (D-3).
 * @param overrides - Fields to override on the default row.
 * @returns A complete `User` row.
 */
function userRow(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'alice@example.com',
    name: null,
    passwordHash: '$2b$10$hash',
    avatarKey: null,
    avatarMimeType: null,
    avatarSize: null,
    avatarUpdatedAt: null,
    tokenVersion: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as User;
}

/**
 * Builds a signature-verified payload as `passport-jwt` hands it over.
 * @param overrides - Claims to override on the default payload.
 * @returns The decoded token payload.
 */
function payload(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return { sub: 'user-1', email: 'alice@example.com', ver: 0, ...overrides };
}

describe('JwtStrategy', () => {
  /** The query bus's `execute`, held on its own so the assertions stay bound. */
  let execute: jest.Mock;
  let strategy: JwtStrategy;

  beforeEach(() => {
    execute = jest.fn();
    const queryBus = { execute } as unknown as QueryBus;
    const config = {
      getOrThrow: jest.fn().mockReturnValue('test-secret'),
    } as unknown as ConfigService;

    strategy = new JwtStrategy(config, queryBus);
  });

  it("looks the caller's row up by the token's subject (D-9)", async () => {
    execute.mockResolvedValue(userRow());

    await Promise.resolve(strategy.validate(payload({ sub: 'user-42' })));

    expect(execute).toHaveBeenCalledTimes(1);
    const [query] = execute.mock.calls[0] as [FindUserByIdQuery];
    expect(query).toBeInstanceOf(FindUserByIdQuery);
    expect(query.userId).toBe('user-42');
  });

  it('accepts a token whose ver matches the row and answers the identity', async () => {
    execute.mockResolvedValue(userRow({ tokenVersion: 3 }));

    await expect(strategy.validate(payload({ ver: 3 }))).resolves.toEqual({
      userId: 'user-1',
      email: 'alice@example.com',
    });
  });

  it('refuses a token whose ver is behind the row — the password changed since (AC-13)', async () => {
    execute.mockResolvedValue(userRow({ tokenVersion: 2 }));

    await expect(strategy.validate(payload({ ver: 1 }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('refuses a token whose ver is ahead of the row, rather than reading it as newer', async () => {
    execute.mockResolvedValue(userRow({ tokenVersion: 1 }));

    await expect(strategy.validate(payload({ ver: 5 }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('accepts a token carrying no ver claim while the row is still at 0 (D-9)', async () => {
    execute.mockResolvedValue(userRow({ tokenVersion: 0 }));
    const legacy = { sub: 'user-1', email: 'alice@example.com' };

    // A missing claim reads as 0, so tokens issued before this shipped stay
    // valid until their own `exp` instead of signing everyone out on deploy.
    await expect(strategy.validate(legacy)).resolves.toEqual({
      userId: 'user-1',
      email: 'alice@example.com',
    });
  });

  it('refuses a token carrying no ver claim once the row has moved past 0', async () => {
    execute.mockResolvedValue(userRow({ tokenVersion: 1 }));
    const legacy = { sub: 'user-1', email: 'alice@example.com' };

    await expect(strategy.validate(legacy)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('refuses a token naming a user that no longer exists', async () => {
    execute.mockResolvedValue(null);

    await expect(strategy.validate(payload())).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
