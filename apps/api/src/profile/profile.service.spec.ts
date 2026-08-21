import { NotFoundException } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { User } from '../../generated/prisma/client';
import { UpdateUserNameCommand } from '../users/commands/update-user-name.command';
import { FindUserByIdQuery } from '../users/queries/find-user-by-id.query';
import { ProfileService } from './profile.service';

/** The exact key set every profile response carries (AC-18, S-1). */
const PROFILE_KEYS = [
  'avatarUpdatedAt',
  'email',
  'hasAvatar',
  'id',
  'name',
] as const;

/**
 * Builds a full Prisma `User` row — including the columns that must never
 * reach the wire — so a mapper that spreads the entity is caught (S-1).
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

describe('ProfileService', () => {
  let queryBus: { execute: jest.Mock };
  let commandBus: { execute: jest.Mock };
  let service: ProfileService;

  beforeEach(() => {
    queryBus = { execute: jest.fn() };
    commandBus = { execute: jest.fn() };
    service = new ProfileService(
      queryBus as unknown as QueryBus,
      commandBus as unknown as CommandBus,
    );
  });

  describe('getProfile', () => {
    it("asks the users module for the caller's own row", async () => {
      queryBus.execute.mockResolvedValue(userRow());

      await service.getProfile('user-1');

      expect(queryBus.execute).toHaveBeenCalledTimes(1);
      const [[query]] = queryBus.execute.mock.calls as [FindUserByIdQuery][];
      expect(query).toBeInstanceOf(FindUserByIdQuery);
      expect(query.userId).toBe('user-1');
    });

    it('returns exactly the five profile keys and nothing else (AC-18, S-1)', async () => {
      queryBus.execute.mockResolvedValue(userRow({ name: 'Alice' }));

      const profile = await service.getProfile('user-1');

      expect(Object.keys(profile).sort()).toEqual([...PROFILE_KEYS]);
      expect(profile).toEqual({
        id: 'user-1',
        email: 'alice@example.com',
        name: 'Alice',
        hasAvatar: false,
        avatarUpdatedAt: null,
      });
    });

    it('never publishes the password hash, token version or avatar key (S-1)', async () => {
      queryBus.execute.mockResolvedValue(
        userRow({ avatarKey: 'avatars/user-1', tokenVersion: 3 }),
      );

      const profile = await service.getProfile('user-1');

      expect(JSON.stringify(profile)).not.toContain('$2b$10$hash');
      expect(profile).not.toHaveProperty('passwordHash');
      expect(profile).not.toHaveProperty('tokenVersion');
      expect(profile).not.toHaveProperty('avatarKey');
      expect(profile).not.toHaveProperty('avatarMimeType');
      expect(profile).not.toHaveProperty('avatarSize');
    });

    it('reports no avatar when the columns are empty', async () => {
      queryBus.execute.mockResolvedValue(userRow());

      const profile = await service.getProfile('user-1');

      expect(profile.hasAvatar).toBe(false);
      expect(profile.avatarUpdatedAt).toBeNull();
    });

    it('computes hasAvatar from avatarKey and exposes avatarUpdatedAt (D-5)', async () => {
      const avatarUpdatedAt = new Date('2026-08-21T09:00:00.000Z');
      queryBus.execute.mockResolvedValue(
        userRow({
          avatarKey: 'users/user-1/avatar/abc',
          avatarMimeType: 'image/png',
          avatarSize: 4096,
          avatarUpdatedAt,
        }),
      );

      const profile = await service.getProfile('user-1');

      // `hasAvatar` is the key's presence, never the key itself — that is
      // what keeps STORAGE_ROOT's layout off the wire (S-1, AC-18).
      expect(profile.hasAvatar).toBe(true);
      expect(profile.avatarUpdatedAt).toBe(avatarUpdatedAt);
      expect(Object.keys(profile).sort()).toEqual([...PROFILE_KEYS]);
    });

    it('throws NotFound when the token names a row that no longer exists', async () => {
      queryBus.execute.mockResolvedValue(null);

      await expect(service.getProfile('user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('updateProfile', () => {
    it('stores the submitted name against the caller and answers the updated profile', async () => {
      commandBus.execute.mockResolvedValue(userRow({ name: 'Alice' }));

      const profile = await service.updateProfile('user-1', { name: 'Alice' });

      expect(commandBus.execute).toHaveBeenCalledTimes(1);
      const [[command]] = commandBus.execute.mock.calls as [
        UpdateUserNameCommand,
      ][];
      expect(command).toBeInstanceOf(UpdateUserNameCommand);
      expect(command.userId).toBe('user-1');
      expect(command.name).toBe('Alice');
      expect(Object.keys(profile).sort()).toEqual([...PROFILE_KEYS]);
      expect(profile.name).toBe('Alice');
    });

    it('clears the name when the submitted value is empty (AC-4)', async () => {
      commandBus.execute.mockResolvedValue(userRow({ name: null }));

      const profile = await service.updateProfile('user-1', { name: '' });

      const [[command]] = commandBus.execute.mock.calls as [
        UpdateUserNameCommand,
      ][];
      expect(command.name).toBe('');
      expect(profile.name).toBeNull();
    });

    it('leaves the name untouched when the payload carries no name at all', async () => {
      queryBus.execute.mockResolvedValue(userRow({ name: 'Alice' }));

      const profile = await service.updateProfile('user-1', {});

      expect(commandBus.execute).not.toHaveBeenCalled();
      expect(profile.name).toBe('Alice');
    });

    it('never publishes the password hash on the update response (S-1)', async () => {
      commandBus.execute.mockResolvedValue(userRow({ name: 'Alice' }));

      const profile = await service.updateProfile('user-1', { name: 'Alice' });

      expect(Object.keys(profile).sort()).toEqual([...PROFILE_KEYS]);
      expect(JSON.stringify(profile)).not.toContain('$2b$10$hash');
    });
  });
});
