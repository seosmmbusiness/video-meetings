import { Command } from '@nestjs/cqrs';

/**
 * Command to mint an access token for one account. It is the only way a
 * token is issued in this app, so the claim set lives in exactly one place
 * and cannot drift from what `JwtStrategy` verifies (D-10).
 */
export class IssueAccessTokenCommand extends Command<string> {
  /**
   * @param userId - The account's database id, signed as `sub`.
   * @param email - The account's email address, signed as `email`.
   * @param tokenVersion - The account's revocation counter at signing time,
   * signed as `ver`; a token whose `ver` no longer matches the account's is
   * refused (D-9, AC-13).
   */
  constructor(
    public readonly userId: string,
    public readonly email: string,
    public readonly tokenVersion: number,
  ) {
    super();
  }
}
