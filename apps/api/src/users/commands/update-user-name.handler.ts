import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import type { User } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserNameCommand } from './update-user-name.command';

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
   */
  execute(command: UpdateUserNameCommand): Promise<User> {
    const { userId, name } = command;

    return this.prisma.user.update({
      where: { id: userId },
      data: { name: name === null || name === '' ? null : name },
    });
  }
}
