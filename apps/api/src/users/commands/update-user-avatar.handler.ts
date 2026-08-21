import { NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Prisma } from '../../../generated/prisma/client';
import type { User } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserAvatarCommand } from './update-user-avatar.command';

const PRISMA_RECORD_NOT_FOUND_ERROR_CODE = 'P2025';

/**
 * Handles {@link UpdateUserAvatarCommand} by writing the avatar's four
 * columns onto one row.
 */
@CommandHandler(UpdateUserAvatarCommand)
export class UpdateUserAvatarHandler implements ICommandHandler<UpdateUserAvatarCommand> {
  /**
   * @param prisma - Database access for the `User` model.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sets or clears the caller's avatar. The four columns move as one group
   * in a single `UPDATE` (D-5): a row must never hold a key without its type
   * and size, nor a size that outlives the bytes it described. The id comes
   * from the caller's verified token, so this is always the caller's own row,
   * and no other column is touched — the name, the credential and
   * `tokenVersion` each move through their own command (D-3).
   * @param command - The user id and the committed avatar, or `null` to clear it.
   * @returns The updated user row.
   * @throws NotFoundException if the id names a row that no longer exists.
   */
  async execute(command: UpdateUserAvatarCommand): Promise<User> {
    const { userId, avatar } = command;
    const data: Prisma.UserUpdateInput =
      avatar === null
        ? {
            avatarKey: null,
            avatarMimeType: null,
            avatarSize: null,
            avatarUpdatedAt: null,
          }
        : {
            avatarKey: avatar.key,
            avatarMimeType: avatar.mimeType,
            avatarSize: avatar.size,
            // Stamped here rather than by the caller: it is what phase 4's
            // image URL is busted by, so it has to move with the key.
            avatarUpdatedAt: new Date(),
          };

    try {
      return await this.prisma.user.update({ where: { id: userId }, data });
    } catch (error) {
      // An access token outlives the row it names — it stays valid for an
      // hour after the account goes. Prisma's "record to update not found"
      // becomes the same 404 the read path already answers, instead of
      // escaping as a 500.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_RECORD_NOT_FOUND_ERROR_CODE
      ) {
        throw new NotFoundException('Profile not found');
      }
      throw error;
    }
  }
}
