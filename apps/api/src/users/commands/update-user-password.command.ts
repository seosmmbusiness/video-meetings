import { Command } from '@nestjs/cqrs';
import type { User } from '../../../generated/prisma/client';

/**
 * Command to replace a user's stored credential.
 */
export class UpdateUserPasswordCommand extends Command<User> {
  /**
   * @param userId - The id of the user to update, taken from the verified token.
   * @param passwordHash - The bcrypt hash of the new password.
   */
  constructor(
    public readonly userId: string,
    public readonly passwordHash: string,
  ) {
    super();
  }
}
