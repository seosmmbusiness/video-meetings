import { Query } from '@nestjs/cqrs';

/**
 * Query to verify a plaintext password against a stored bcrypt hash.
 */
export class VerifyPasswordQuery extends Query<boolean> {
  /**
   * @param password - The plaintext password to verify.
   * @param storedHash - The user's stored bcrypt hash, or `null` if no user
   * was found — the handler still runs a (dummy-hash) comparison in that
   * case, so callers get timing-safe behavior for free.
   */
  constructor(
    public readonly password: string,
    public readonly storedHash: string | null,
  ) {
    super();
  }
}
