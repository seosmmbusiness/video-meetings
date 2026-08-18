import { NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Prisma } from '../../../generated/prisma/client';
import type { User } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserNameCommand } from './update-user-name.command';

const PRISMA_RECORD_NOT_FOUND_ERROR_CODE = 'P2025';

/**
 * Handles {@link UpdateUserNameCommand} by writing the name onto one row.
 */
@CommandHandler(UpdateUserNameCommand)
export class UpdateUserNameHandler implements ICommandHandler<UpdateUserNameCommand> {
  /**
   * @param prisma - Database access for the `User` model.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sets the user's display name, storing an empty value as `NULL` — that is
   * how a name is cleared (AC-4). The id comes from the caller's verified
   * token, so this is always the caller's own row; no other column is
   * touched, since the credential and `tokenVersion` move through their own
   * command (D-3).
   * @param command - The user id and the already-normalised name.
   * @returns The updated user row.
   * @throws NotFoundException if the id names a row that no longer exists.
   */
  async execute(command: UpdateUserNameCommand): Promise<User> {
    const { userId, name } = command;

    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: { name: name === null || name === '' ? null : name },
      });
    } catch (error) {
      // An access token outlives the row it names — it stays valid for an
      // hour after the account goes. Prisma's "record to update not found"
      // becomes the same 404 the read path already answers, instead of
      // escaping as a 500 and contradicting the route's own annotation.
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
