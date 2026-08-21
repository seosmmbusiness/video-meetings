import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import type { User } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserAvatarCommand } from './update-user-avatar.command';

/**
 * Handles {@link UpdateUserAvatarCommand} by writing the avatar's four
 * columns onto one row.
 *
 * Unimplemented shell — it ships with the failing specs so the typed lint
 * gate can resolve the names they use; the commit after this one is what
 * makes it behave.
 */
@CommandHandler(UpdateUserAvatarCommand)
export class UpdateUserAvatarHandler implements ICommandHandler<UpdateUserAvatarCommand> {
  /**
   * @param prisma - Database access for the `User` model.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sets or clears the caller's avatar columns.
   * @param command - The user id and the avatar metadata, or `null` to clear.
   * @returns The updated user row.
   */
  execute(command: UpdateUserAvatarCommand): Promise<User> {
    void this.prisma;
    void command;
    return Promise.reject(new Error('Not implemented'));
  }
}
