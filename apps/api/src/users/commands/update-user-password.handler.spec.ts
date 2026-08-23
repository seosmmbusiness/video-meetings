import { NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import type { User } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserPasswordCommand } from './update-user-password.command';
import { UpdateUserPasswordHandler } from './update-user-password.handler';

describe('UpdateUserPasswordHandler', () => {
  let update: jest.Mock;
  let handler: UpdateUserPasswordHandler;

  beforeEach(() => {
    update = jest.fn().mockResolvedValue({ id: 'user-1' });
    handler = new UpdateUserPasswordHandler({
      user: { update },
    } as unknown as PrismaService);
  });

  it("writes the new hash onto the caller's own row (D-3)", async () => {
    await handler.execute(
      new UpdateUserPasswordCommand('user-1', '$2b$12$newhash'),
    );

    expect(update).toHaveBeenCalledTimes(1);
    const [{ where, data }] = update.mock.calls[0] as [
      { where: { id: string }; data: Record<string, unknown> },
    ];
    expect(where).toEqual({ id: 'user-1' });
    expect(data.passwordHash).toBe('$2b$12$newhash');
  });

  it('touches no column outside the credential (D-3)', async () => {
    await handler.execute(
      new UpdateUserPasswordCommand('user-1', '$2b$12$newhash'),
    );

    const [{ data }] = update.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    // The name and the avatar group each move through their own command.
    expect(data).not.toHaveProperty('name');
    expect(data).not.toHaveProperty('email');
    expect(data).not.toHaveProperty('avatarKey');
  });

  it('returns the updated row', async () => {
    const row = { id: 'user-1', passwordHash: '$2b$12$newhash' } as User;
    update.mockResolvedValue(row);

    await expect(
      handler.execute(
        new UpdateUserPasswordCommand('user-1', '$2b$12$newhash'),
      ),
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
      handler.execute(
        new UpdateUserPasswordCommand('user-1', '$2b$12$newhash'),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets any other database failure escape unchanged', async () => {
    const failure = new Error('connection lost');
    update.mockRejectedValue(failure);

    await expect(
      handler.execute(
        new UpdateUserPasswordCommand('user-1', '$2b$12$newhash'),
      ),
    ).rejects.toBe(failure);
  });
});
