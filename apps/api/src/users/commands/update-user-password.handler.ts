import { NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Prisma } from '../../../generated/prisma/client';
import type { User } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserPasswordCommand } from './update-user-password.command';

const PRISMA_RECORD_NOT_FOUND_ERROR_CODE = 'P2025';

/**
 * Handles {@link UpdateUserPasswordCommand} by writing the new credential
 * onto one row.
 */
@CommandHandler(UpdateUserPasswordCommand)
export class UpdateUserPasswordHandler implements ICommandHandler<UpdateUserPasswordCommand> {
  /**
   * @param prisma - Database access for the `User` model.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes the caller's new password hash and bumps the revocation counter
   * every token carries as its `ver` claim, in one `UPDATE` — so no session
   * survives in a window between a committed hash and a committed increment
   * (D-9, AC-13). The id comes from the caller's verified token, so this is
   * always the caller's own row, and no other column is touched — the name
   * and the avatar group each move through their own command (D-3).
   * @param command - The user id and the new bcrypt hash.
   * @returns The updated user row.
   * @throws NotFoundException if the id names a row that no longer exists.
   */
  async execute(command: UpdateUserPasswordCommand): Promise<User> {
    const { userId, passwordHash } = command;

    try {
      return await this.prisma.user.update({
        where: { id: userId },
        // An atomic increment rather than a value read first: two concurrent
        // changes both have to count, or one of them leaves live tokens.
        data: { passwordHash, tokenVersion: { increment: 1 } },
      });
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
