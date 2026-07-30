import { Command } from '@nestjs/cqrs';
import type { User } from '../../../generated/prisma/client';

/**
 * Command to create a new user with an already-hashed password.
 */
export class CreateUserCommand extends Command<User> {
  /**
   * @param email - The user's (already normalized) email address.
   * @param passwordHash - The bcrypt hash of the user's password.
   * @param consentToTerms - Whether the user accepted the service terms.
   */
  constructor(
    public readonly email: string,
    public readonly passwordHash: string,
    public readonly consentToTerms: boolean,
  ) {
    super();
  }
}
