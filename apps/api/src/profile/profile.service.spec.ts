import {
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { User } from '../../generated/prisma/client';
import { IssueAccessTokenCommand } from '../auth/commands/issue-access-token.command';
import { HashPasswordCommand } from '../credentials/commands/hash-password.command';
import { VerifyPasswordQuery } from '../credentials/queries/verify-password.query';
import { UpdateUserAvatarCommand } from '../users/commands/update-user-avatar.command';
import { UpdateUserNameCommand } from '../users/commands/update-user-name.command';
import { UpdateUserPasswordCommand } from '../users/commands/update-user-password.command';
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

/** The staged upload a route hands the service once multer has written it. */
const STAGED_UPLOAD = {
  path: '/tmp/uploads/tmp/staged-avatar',
  mimetype: 'image/png',
  size: 2048,
};

/** The key shape D-7 mandates: a per-user prefix and a fresh UUID per upload. */
const AVATAR_KEY_PATTERN =
  /^users\/user-1\/avatar\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('ProfileService', () => {
  let queryBus: { execute: jest.Mock };
  let commandBus: { execute: jest.Mock };
  let storage: {
    save: jest.Mock;
    delete: jest.Mock;
    stat: jest.Mock;
    createReadStream: jest.Mock;
    localPathFor: jest.Mock;
  };
  let service: ProfileService;

  beforeEach(() => {
    queryBus = { execute: jest.fn() };
    commandBus = { execute: jest.fn() };
    storage = {
      save: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      stat: jest.fn(),
      createReadStream: jest.fn(),
      localPathFor: jest.fn(),
    };
    service = new ProfileService(
      queryBus as unknown as QueryBus,
      commandBus as unknown as CommandBus,
      storage,
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

  describe('setAvatar', () => {
    const PREVIOUS_KEY =
      'users/user-1/avatar/00000000-0000-4000-8000-000000000000';

    /**
     * Reads the command the service dispatched, so a case can assert what it
     * carried without repeating the cast.
     * @returns The dispatched avatar command.
     */
    function dispatchedAvatarCommand(): UpdateUserAvatarCommand {
      const [[command]] = commandBus.execute.mock.calls as [
        UpdateUserAvatarCommand,
      ][];
      return command;
    }

    beforeEach(() => {
      queryBus.execute.mockResolvedValue(userRow());
      commandBus.execute.mockResolvedValue(
        userRow({
          avatarKey: 'users/user-1/avatar/new',
          avatarMimeType: 'image/png',
          avatarSize: 2048,
          avatarUpdatedAt: new Date('2026-08-21T10:00:00.000Z'),
        }),
      );
    });

    it('commits the staged bytes under users/<id>/avatar/<uuid> (D-7)', async () => {
      await service.setAvatar('user-1', STAGED_UPLOAD);

      expect(storage.save).toHaveBeenCalledTimes(1);
      const [key, tempPath] = storage.save.mock.calls[0] as [string, string];
      expect(key).toMatch(AVATAR_KEY_PATTERN);
      expect(tempPath).toBe(STAGED_UPLOAD.path);
    });

    it('uses a fresh key for every upload, which is what makes a replacement atomic (AC-6)', async () => {
      await service.setAvatar('user-1', STAGED_UPLOAD);
      await service.setAvatar('user-1', STAGED_UPLOAD);

      const [firstKey] = storage.save.mock.calls[0] as [string];
      const [secondKey] = storage.save.mock.calls[1] as [string];
      expect(secondKey).not.toBe(firstKey);
    });

    it('writes the four columns with the detected type and size, after the bytes are committed (D-5, D-7)', async () => {
      await service.setAvatar('user-1', {
        ...STAGED_UPLOAD,
        mimetype: 'image/webp',
        size: 4096,
      });

      const command = dispatchedAvatarCommand();
      expect(command).toBeInstanceOf(UpdateUserAvatarCommand);
      expect(command.userId).toBe('user-1');
      const [savedKey] = storage.save.mock.calls[0] as [string];
      expect(command.avatar).toEqual({
        key: savedKey,
        mimeType: 'image/webp',
        size: 4096,
      });
      expect(storage.save.mock.invocationCallOrder[0]).toBeLessThan(
        commandBus.execute.mock.invocationCallOrder[0],
      );
    });

    it("deletes the previous key's bytes only once the row points at the new one (S-5, AC-6)", async () => {
      queryBus.execute.mockResolvedValue(userRow({ avatarKey: PREVIOUS_KEY }));

      await service.setAvatar('user-1', STAGED_UPLOAD);

      expect(storage.delete).toHaveBeenCalledTimes(1);
      expect(storage.delete).toHaveBeenCalledWith(PREVIOUS_KEY);
      expect(commandBus.execute.mock.invocationCallOrder[0]).toBeLessThan(
        storage.delete.mock.invocationCallOrder[0],
      );
    });

    it('deletes nothing when the account had no avatar yet', async () => {
      await service.setAvatar('user-1', STAGED_UPLOAD);

      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('survives a failed delete of the previous bytes, logging a count and never the key (S-5)', async () => {
      queryBus.execute.mockResolvedValue(userRow({ avatarKey: PREVIOUS_KEY }));
      storage.delete.mockRejectedValue(new Error('EACCES'));
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const profile = await service.setAvatar('user-1', STAGED_UPLOAD);

      expect(profile.hasAvatar).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      const [message] = warn.mock.calls[0] as [string];
      expect(message).toContain('1');
      expect(message).not.toContain(PREVIOUS_KEY);
      warn.mockRestore();
    });

    it('removes the bytes it just committed when the column write fails, so nothing is orphaned (S-5)', async () => {
      const failure = new Error('write failed');
      commandBus.execute.mockRejectedValue(failure);

      await expect(service.setAvatar('user-1', STAGED_UPLOAD)).rejects.toBe(
        failure,
      );

      const [savedKey] = storage.save.mock.calls[0] as [string];
      expect(storage.delete).toHaveBeenCalledWith(savedKey);
    });

    it('throws NotFound without committing anything when the row no longer exists', async () => {
      queryBus.execute.mockResolvedValue(null);

      await expect(
        service.setAvatar('user-1', STAGED_UPLOAD),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.save).not.toHaveBeenCalled();
      expect(commandBus.execute).not.toHaveBeenCalled();
    });

    it('answers exactly the five profile keys, never the storage key (S-1, AC-18)', async () => {
      const profile = await service.setAvatar('user-1', STAGED_UPLOAD);

      expect(Object.keys(profile).sort()).toEqual([...PROFILE_KEYS]);
      expect(profile.hasAvatar).toBe(true);
      expect(JSON.stringify(profile)).not.toContain('avatar/new');
      expect(JSON.stringify(profile)).not.toContain('$2b$10$hash');
    });
  });

  describe('removeAvatar', () => {
    const STORED_KEY =
      'users/user-1/avatar/11111111-1111-4111-8111-111111111111';

    beforeEach(() => {
      queryBus.execute.mockResolvedValue(userRow({ avatarKey: STORED_KEY }));
      commandBus.execute.mockResolvedValue(userRow());
    });

    it('clears the four columns first and deletes the bytes after (D-7)', async () => {
      const profile = await service.removeAvatar('user-1');

      const [[command]] = commandBus.execute.mock.calls as [
        UpdateUserAvatarCommand,
      ][];
      expect(command).toBeInstanceOf(UpdateUserAvatarCommand);
      expect(command.userId).toBe('user-1');
      expect(command.avatar).toBeNull();
      expect(storage.delete).toHaveBeenCalledWith(STORED_KEY);
      // Row first, bytes second: an interrupted removal leaves unreachable
      // bytes rather than a row pointing at nothing (D-7).
      expect(commandBus.execute.mock.invocationCallOrder[0]).toBeLessThan(
        storage.delete.mock.invocationCallOrder[0],
      );
      expect(profile.hasAvatar).toBe(false);
      expect(profile.avatarUpdatedAt).toBeNull();
    });

    it('is a no-op when the account has no avatar', async () => {
      queryBus.execute.mockResolvedValue(userRow());

      const profile = await service.removeAvatar('user-1');

      expect(commandBus.execute).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
      expect(profile.hasAvatar).toBe(false);
    });

    it('survives a failed delete, logging a count and never the key (S-5)', async () => {
      storage.delete.mockRejectedValue(new Error('EACCES'));
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const profile = await service.removeAvatar('user-1');

      expect(profile.hasAvatar).toBe(false);
      const [message] = warn.mock.calls[0] as [string];
      expect(message).not.toContain(STORED_KEY);
      warn.mockRestore();
    });

    it('throws NotFound when the row no longer exists', async () => {
      queryBus.execute.mockResolvedValue(null);

      await expect(service.removeAvatar('user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('answers exactly the five profile keys (S-1, AC-18)', async () => {
      const profile = await service.removeAvatar('user-1');

      expect(Object.keys(profile).sort()).toEqual([...PROFILE_KEYS]);
      expect(JSON.stringify(profile)).not.toContain(STORED_KEY);
    });
  });

  describe('getAvatarFile', () => {
    const STORED_KEY =
      'users/user-1/avatar/22222222-2222-4222-8222-222222222222';
    const LOCAL_PATH = `/srv/.data/uploads/${STORED_KEY}`;

    beforeEach(() => {
      queryBus.execute.mockResolvedValue(
        userRow({
          avatarKey: STORED_KEY,
          avatarMimeType: 'image/webp',
          avatarSize: 2048,
          avatarUpdatedAt: new Date('2026-08-21T10:00:00.000Z'),
        }),
      );
      storage.localPathFor.mockReturnValue(LOCAL_PATH);
    });

    it("resolves the key from the caller's own row alone (AC-15, D-8)", async () => {
      await expect(service.getAvatarFile('user-1')).resolves.toEqual({
        path: LOCAL_PATH,
        mimeType: 'image/webp',
      });

      const [[query]] = queryBus.execute.mock.calls as [FindUserByIdQuery][];
      expect(query).toBeInstanceOf(FindUserByIdQuery);
      expect(query.userId).toBe('user-1');
      expect(storage.localPathFor).toHaveBeenCalledWith(STORED_KEY);
    });

    it('throws NotFound when the account has no avatar (AC-9)', async () => {
      queryBus.execute.mockResolvedValue(userRow());

      await expect(service.getAvatarFile('user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(storage.localPathFor).not.toHaveBeenCalled();
    });

    it('throws NotFound when the row no longer exists', async () => {
      queryBus.execute.mockResolvedValue(null);

      await expect(service.getAvatarFile('user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('falls back to the detected type stored beside the key', async () => {
      queryBus.execute.mockResolvedValue(
        userRow({ avatarKey: STORED_KEY, avatarMimeType: 'image/jpeg' }),
      );

      await expect(service.getAvatarFile('user-1')).resolves.toEqual({
        path: LOCAL_PATH,
        mimeType: 'image/jpeg',
      });
    });

    it('refuses to guess a path for a backend that has none', async () => {
      storage.localPathFor.mockReturnValue(null);

      await expect(service.getAvatarFile('user-1')).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });
  });

  describe('changePassword', () => {
    /** A change whose current password is the account's own. */
    const CHANGE = {
      currentPassword: 'Str0ngPass',
      newPassword: 'N3wStrongPass',
    };

    beforeEach(() => {
      queryBus.execute.mockImplementation((query: unknown) =>
        query instanceof VerifyPasswordQuery
          ? Promise.resolve(true)
          : Promise.resolve(userRow()),
      );
      commandBus.execute.mockImplementation((command: unknown) => {
        if (command instanceof HashPasswordCommand) {
          return Promise.resolve('$2b$12$newhash');
        }
        if (command instanceof IssueAccessTokenCommand) {
          return Promise.resolve('signed.jwt.token');
        }
        // The write answers the row as it is after the increment, which is
        // the only place the fresh token's `ver` may come from (D-9, D-10).
        return Promise.resolve(
          userRow({ passwordHash: '$2b$12$newhash', tokenVersion: 1 }),
        );
      });
    });

    it("verifies the current password against the caller's own stored hash (D-11)", async () => {
      await service.changePassword('user-1', CHANGE);

      const [verify] = queryBus.execute.mock.calls
        .map(([query]: [unknown]) => query)
        .filter(
          (query: unknown): query is VerifyPasswordQuery =>
            query instanceof VerifyPasswordQuery,
        );
      expect(verify.password).toBe('Str0ngPass');
      expect(verify.storedHash).toBe('$2b$10$hash');
    });

    it('hashes the new password through the credentials module (D-11)', async () => {
      await service.changePassword('user-1', CHANGE);

      const [hash] = commandBus.execute.mock.calls
        .map(([command]: [unknown]) => command)
        .filter(
          (command: unknown): command is HashPasswordCommand =>
            command instanceof HashPasswordCommand,
        );
      expect(hash.password).toBe('N3wStrongPass');
    });

    it('writes the new hash through the users module (D-3)', async () => {
      await service.changePassword('user-1', CHANGE);

      const [write] = commandBus.execute.mock.calls
        .map(([command]: [unknown]) => command)
        .filter(
          (command: unknown): command is UpdateUserPasswordCommand =>
            command instanceof UpdateUserPasswordCommand,
        );
      expect(write.userId).toBe('user-1');
      expect(write.passwordHash).toBe('$2b$12$newhash');
    });

    it('refuses a wrong current password with 403, never 401 (AC-11, D-11)', async () => {
      queryBus.execute.mockImplementation((query: unknown) =>
        query instanceof VerifyPasswordQuery
          ? Promise.resolve(false)
          : Promise.resolve(userRow()),
      );

      await expect(
        service.changePassword('user-1', CHANGE),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('names the refusal in the words the web form shows verbatim (AC-11)', async () => {
      queryBus.execute.mockImplementation((query: unknown) =>
        query instanceof VerifyPasswordQuery
          ? Promise.resolve(false)
          : Promise.resolve(userRow()),
      );

      await expect(service.changePassword('user-1', CHANGE)).rejects.toThrow(
        'Current password is incorrect.',
      );
    });

    it('changes nothing when the current password is wrong (AC-11)', async () => {
      queryBus.execute.mockImplementation((query: unknown) =>
        query instanceof VerifyPasswordQuery
          ? Promise.resolve(false)
          : Promise.resolve(userRow()),
      );

      await expect(service.changePassword('user-1', CHANGE)).rejects.toThrow();

      // Neither the hashing cost nor the write is reached: a refused attempt
      // leaves the stored credential exactly as it was.
      expect(commandBus.execute).not.toHaveBeenCalled();
    });

    it('throws NotFound when the token names a row that is gone', async () => {
      queryBus.execute.mockImplementation((query: unknown) =>
        query instanceof VerifyPasswordQuery
          ? Promise.resolve(true)
          : Promise.resolve(null),
      );

      await expect(
        service.changePassword('user-1', CHANGE),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('never returns the row it was built from (S-1, AC-18)', async () => {
      const result = await service.changePassword('user-1', CHANGE);

      expect(JSON.stringify(result ?? null)).not.toContain('$2b$');
    });

    it('answers exactly { accessToken } and nothing else (AC-18, S-1)', async () => {
      const result = await service.changePassword('user-1', CHANGE);

      expect(Object.keys(result)).toEqual(['accessToken']);
      expect(result.accessToken).toBe('signed.jwt.token');
    });

    it("mints through the auth module's one token handler (D-10)", async () => {
      await service.changePassword('user-1', CHANGE);

      const [issue] = commandBus.execute.mock.calls
        .map(([command]: [unknown]) => command)
        .filter(
          (command: unknown): command is IssueAccessTokenCommand =>
            command instanceof IssueAccessTokenCommand,
        );
      expect(issue.userId).toBe('user-1');
      expect(issue.email).toBe('alice@example.com');
    });

    it('signs after the increment, so the fresh token survives it (AC-13)', async () => {
      await service.changePassword('user-1', CHANGE);

      const commands = commandBus.execute.mock.calls.map(
        ([command]: [unknown]) => command,
      );
      const writeIndex = commands.findIndex(
        (command: unknown) => command instanceof UpdateUserPasswordCommand,
      );
      const issueIndex = commands.findIndex(
        (command: unknown) => command instanceof IssueAccessTokenCommand,
      );
      expect(issueIndex).toBeGreaterThan(writeIndex);

      // ...and it carries the counter the write returned, not the one the
      // row had before it: a token minted at the old version would be
      // refused by the caller's very next request.
      const issued = commands[issueIndex] as IssueAccessTokenCommand;
      expect(issued.tokenVersion).toBe(1);
    });

    it('mints nothing when the current password is wrong (AC-11)', async () => {
      queryBus.execute.mockImplementation((query: unknown) =>
        query instanceof VerifyPasswordQuery
          ? Promise.resolve(false)
          : Promise.resolve(userRow()),
      );

      await expect(service.changePassword('user-1', CHANGE)).rejects.toThrow();

      expect(
        commandBus.execute.mock.calls.some(
          ([command]: [unknown]) => command instanceof IssueAccessTokenCommand,
        ),
      ).toBe(false);
    });
  });
});
