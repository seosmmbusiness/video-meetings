import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { User } from '../../generated/prisma/client';
import { HashPasswordCommand } from '../credentials/commands/hash-password.command';
import { VerifyPasswordQuery } from '../credentials/queries/verify-password.query';
import { CreateUserCommand } from '../users/commands/create-user.command';
import { FindUserByEmailQuery } from '../users/queries/find-user-by-email.query';
import { AuthService } from './auth.service';
import { IssueAccessTokenCommand } from './commands/issue-access-token.command';

/**
 * Builds a full Prisma `User` row so a flow that leaks the entity — or reads
 * the wrong column onto a claim — is caught.
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

/** A valid registration payload. */
const REGISTER = {
  email: 'alice@example.com',
  password: 'Str0ngPass',
  consentToTerms: true,
};

/** A valid login payload. */
const LOGIN = { email: 'alice@example.com', password: 'Str0ngPass' };

describe('AuthService', () => {
  let commandBus: { execute: jest.Mock };
  let queryBus: { execute: jest.Mock };
  let service: AuthService;

  /**
   * Picks the token-issuing command out of everything put on the command bus.
   * @returns The issued command, or `undefined` if none was issued.
   */
  function issuedCommand(): IssueAccessTokenCommand | undefined {
    return commandBus.execute.mock.calls
      .map(([command]: [unknown]) => command)
      .find(
        (command: unknown): command is IssueAccessTokenCommand =>
          command instanceof IssueAccessTokenCommand,
      );
  }

  beforeEach(() => {
    commandBus = { execute: jest.fn() };
    queryBus = { execute: jest.fn() };
    service = new AuthService(
      commandBus as unknown as CommandBus,
      queryBus as unknown as QueryBus,
    );
  });

  describe('register', () => {
    beforeEach(() => {
      queryBus.execute.mockResolvedValue(null);
      commandBus.execute.mockImplementation((command: unknown) => {
        if (command instanceof HashPasswordCommand) {
          return Promise.resolve('$2b$12$hash');
        }
        if (command instanceof CreateUserCommand) {
          return Promise.resolve(userRow({ tokenVersion: 0 }));
        }
        return Promise.resolve('signed.jwt.token');
      });
    });

    it("mints through the auth module's one token handler (D-10)", async () => {
      await expect(service.register(REGISTER)).resolves.toEqual({
        accessToken: 'signed.jwt.token',
      });

      const issued = issuedCommand();
      expect(issued).toBeDefined();
      expect(issued?.userId).toBe('user-1');
      expect(issued?.email).toBe('alice@example.com');
    });

    it("carries the new account's tokenVersion as its ver claim (D-9)", async () => {
      await service.register(REGISTER);

      // Without this the fresh token would carry no `ver` at all, and the
      // guard would read it as 0 by accident rather than by fact.
      expect(issuedCommand()?.tokenVersion).toBe(0);
    });

    it('refuses an email that is already registered', async () => {
      queryBus.execute.mockResolvedValue(userRow());

      await expect(service.register(REGISTER)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(issuedCommand()).toBeUndefined();
    });
  });

  describe('login', () => {
    beforeEach(() => {
      queryBus.execute.mockImplementation((query: unknown) =>
        query instanceof VerifyPasswordQuery
          ? Promise.resolve(true)
          : Promise.resolve(userRow({ tokenVersion: 4 })),
      );
      commandBus.execute.mockResolvedValue('signed.jwt.token');
    });

    it("mints through the auth module's one token handler (D-10)", async () => {
      await expect(service.login(LOGIN)).resolves.toEqual({
        accessToken: 'signed.jwt.token',
      });

      const issued = issuedCommand();
      expect(issued?.userId).toBe('user-1');
      expect(issued?.email).toBe('alice@example.com');
    });

    it("carries the account's current tokenVersion, not a default (D-9, D-10)", async () => {
      await service.login(LOGIN);

      // A login that signed without `ver` would be refused on its very next
      // request by any account that has ever changed its password.
      expect(issuedCommand()?.tokenVersion).toBe(4);
    });

    it('refuses a wrong password without minting anything', async () => {
      queryBus.execute.mockImplementation((query: unknown) =>
        query instanceof VerifyPasswordQuery
          ? Promise.resolve(false)
          : Promise.resolve(userRow()),
      );

      await expect(service.login(LOGIN)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(issuedCommand()).toBeUndefined();
    });

    it('refuses an unknown email without minting anything', async () => {
      queryBus.execute.mockImplementation((query: unknown) =>
        query instanceof FindUserByEmailQuery
          ? Promise.resolve(null)
          : Promise.resolve(false),
      );

      await expect(service.login(LOGIN)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(issuedCommand()).toBeUndefined();
    });
  });
});
