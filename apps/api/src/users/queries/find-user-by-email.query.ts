import { Query } from '@nestjs/cqrs';
import type { User } from '../../../generated/prisma/client';

/**
 * Query to look up a user by email address.
 */
export class FindUserByEmailQuery extends Query<User | null> {
  /**
   * @param email - The (already normalized) email address to look up.
   */
  constructor(public readonly email: string) {
    super();
  }
}
