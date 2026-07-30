import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import * as bcrypt from 'bcrypt';
import { VerifyPasswordQuery } from './verify-password.query';

// A bcrypt hash of an unguessable, unused password. Compared against when
// storedHash is null, so a verification for an unregistered account costs
// the same wall-clock time as one for a registered account with a wrong
// password — response timing can't be used to enumerate valid accounts.
const DUMMY_PASSWORD_HASH =
  '$2b$12$C6UzMDM.H6dfI/f/IKcEeO6bh2xLpU8iuw1RG5hV3ZQ4gzGvvBQ8W';

/**
 * Handles {@link VerifyPasswordQuery} by timing-safe-comparing a password
 * against a stored bcrypt hash.
 */
@QueryHandler(VerifyPasswordQuery)
export class VerifyPasswordHandler implements IQueryHandler<VerifyPasswordQuery> {
  /**
   * Verifies a plaintext password against a stored hash.
   * @param query - The plaintext password and the stored hash (or `null`).
   * @returns Whether the password matches.
   */
  execute(query: VerifyPasswordQuery): Promise<boolean> {
    return bcrypt.compare(
      query.password,
      query.storedHash ?? DUMMY_PASSWORD_HASH,
    );
  }
}
