import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import type { User } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserPasswordCommand } from './update-user-password.command';

/**
 * Handles {@link UpdateUserPasswordCommand} by writing the new credential
 * onto one row.
 *
 * Unimplemented shell — it ships with the failing specs so the typed lint
 * gate can resolve the names they use; the commit after this one is what
 * makes it behave.
 */
@CommandHandler(UpdateUserPasswordCommand)
export class UpdateUserPasswordHandler implements ICommandHandler<UpdateUserPasswordCommand> {
  /**
   * @param prisma - Database access for the `User` model.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes the caller's new password hash.
   * @param command - The user id and the new bcrypt hash.
   * @returns The updated user row.
   */
  execute(command: UpdateUserPasswordCommand): Promise<User> {
    void this.prisma;
    void command;
    return Promise.reject(new Error('Not implemented'));
  }
}
