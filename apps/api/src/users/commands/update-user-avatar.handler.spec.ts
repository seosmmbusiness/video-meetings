import { NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import type { User } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserAvatarCommand } from './update-user-avatar.command';
import { UpdateUserAvatarHandler } from './update-user-avatar.handler';

/** The four columns this command owns, set and cleared as one group (D-5). */
const AVATAR_COLUMNS = [
  'avatarKey',
  'avatarMimeType',
  'avatarSize',
  'avatarUpdatedAt',
] as const;

describe('UpdateUserAvatarHandler', () => {
  let update: jest.Mock;
  let handler: UpdateUserAvatarHandler;

  beforeEach(() => {
    update = jest.fn().mockResolvedValue({ id: 'user-1' });
    handler = new UpdateUserAvatarHandler({
      user: { update },
    } as unknown as PrismaService);
  });

  it("writes all four columns together, keyed by the caller's own id (D-5)", async () => {
    const before = Date.now();

    await handler.execute(
      new UpdateUserAvatarCommand('user-1', {
        key: 'users/user-1/avatar/abc',
        mimeType: 'image/png',
        size: 1234,
      }),
    );

    expect(update).toHaveBeenCalledTimes(1);
    const [{ where, data }] = update.mock.calls[0] as [
      { where: { id: string }; data: Record<string, unknown> },
    ];
    expect(where).toEqual({ id: 'user-1' });
    expect(Object.keys(data).sort()).toEqual([...AVATAR_COLUMNS]);
    expect(data.avatarKey).toBe('users/user-1/avatar/abc');
    expect(data.avatarMimeType).toBe('image/png');
    expect(data.avatarSize).toBe(1234);
    expect((data.avatarUpdatedAt as Date).getTime()).toBeGreaterThanOrEqual(
      before,
    );
  });

  it('clears all four columns together when the avatar is removed (D-5, AC-9)', async () => {
    await handler.execute(new UpdateUserAvatarCommand('user-1', null));

    const [{ data }] = update.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(data).toEqual({
      avatarKey: null,
      avatarMimeType: null,
      avatarSize: null,
      avatarUpdatedAt: null,
    });
  });

  it('touches no column outside the avatar group (D-3)', async () => {
    await handler.execute(
      new UpdateUserAvatarCommand('user-1', {
        key: 'users/user-1/avatar/abc',
        mimeType: 'image/webp',
        size: 10,
      }),
    );

    const [{ data }] = update.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    // The credential and the revocation counter move through their own
    // command, and the name through its own — this one owns four columns.
    expect(data).not.toHaveProperty('passwordHash');
    expect(data).not.toHaveProperty('tokenVersion');
    expect(data).not.toHaveProperty('name');
    expect(data).not.toHaveProperty('email');
  });

  it('returns the updated row', async () => {
    const row = { id: 'user-1', avatarKey: 'users/user-1/avatar/abc' } as User;
    update.mockResolvedValue(row);

    await expect(
      handler.execute(new UpdateUserAvatarCommand('user-1', null)),
    ).resolves.toBe(row);
  });

  it('answers a 404 rather than a 500 when the row is already gone', async () => {
    // An access token outlives the row it names by up to an hour, so a
    // caller can reach this with a valid token and no account.
    update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('not found', {
        code: 'P2025',
        clientVersion: '6',
      }),
    );

    await expect(
      handler.execute(new UpdateUserAvatarCommand('user-1', null)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets any other database failure escape unchanged', async () => {
    const failure = new Error('connection lost');
    update.mockRejectedValue(failure);

    await expect(
      handler.execute(new UpdateUserAvatarCommand('user-1', null)),
    ).rejects.toBe(failure);
  });
});
