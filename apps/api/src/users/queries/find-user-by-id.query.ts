import { Query } from '@nestjs/cqrs';
import type { User } from '../../../generated/prisma/client';

/**
 * Query to look up a user by id.
 */
export class FindUserByIdQuery extends Query<User | null> {
  /**
   * @param userId - The id of the user to look up, taken from the verified token.
   */
  constructor(public readonly userId: string) {
    super();
  }
}
