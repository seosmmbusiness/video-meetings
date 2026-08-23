import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { JwtService } from '@nestjs/jwt';
import { IssueAccessTokenCommand } from './issue-access-token.command';

/**
 * Handles {@link IssueAccessTokenCommand} by signing the app's one claim set.
 */
@CommandHandler(IssueAccessTokenCommand)
export class IssueAccessTokenHandler implements ICommandHandler<IssueAccessTokenCommand> {
  /**
   * @param jwtService - The configured signer; the secret and the expiry come
   * from `AuthModule`'s registration, not from here.
   */
  constructor(private readonly jwtService: JwtService) {}

  /**
   * Signs an access token for one account. Register, login and the password
   * change all arrive here, so `ver` cannot be omitted on one path and read
   * as `0` by the guard on the next request (D-9, D-10).
   * @param command - The account's id, email and revocation counter.
   * @returns The signed JWT string.
   */
  execute(command: IssueAccessTokenCommand): Promise<string> {
    return this.jwtService.signAsync({
      sub: command.userId,
      email: command.email,
      ver: command.tokenVersion,
    });
  }
}
