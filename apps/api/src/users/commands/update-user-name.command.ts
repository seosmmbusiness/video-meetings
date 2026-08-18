import { Command } from '@nestjs/cqrs';
import type { User } from '../../../generated/prisma/client';

/**
 * Command to set (or clear) a user's display name.
 */
export class UpdateUserNameCommand extends Command<User> {
  /**
   * @param userId - The id of the user to update, taken from the verified token.
   * @param name - The already-normalised name, or an empty string/`null` to clear it.
   */
  constructor(
    public readonly userId: string,
    public readonly name: string | null,
  ) {
    super();
  }
}
