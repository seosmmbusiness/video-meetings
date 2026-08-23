import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryBus } from '@nestjs/cqrs';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { User } from '../../../generated/prisma/client';
import { FindUserByIdQuery } from '../../users/queries/find-user-by-id.query';

/** Payload encoded in access tokens issued by {@link AuthService}. */
export interface JwtPayload {
  sub: string;
  email: string;
  /**
   * The account's revocation counter when the token was minted. Absent on
   * tokens issued before per-account revocation shipped, and read as `0`
   * (D-9).
   */
  ver?: number;
}

/** User shape attached to `Request.user` once a token has been verified. */
export interface AuthenticatedUser {
  userId: string;
  email: string;
}

/**
 * Validates the `Authorization: Bearer <token>` header against `JWT_SECRET`
 * and exposes the decoded identity as `Request.user`.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  /**
   * @param config - Used to read the `JWT_SECRET` the tokens were signed with.
   * @param queryBus - Used to look the token's subject up on every request,
   *   which is what makes a session revocable (D-9).
   */
  constructor(
    config: ConfigService,
    private readonly queryBus: QueryBus,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * Maps a verified JWT payload to the shape stored on `Request.user`, after
   * confirming the account still exists and the token has not been revoked.
   * The signature alone is not enough: a password change increments the
   * account's `tokenVersion`, and every token minted before it carries the
   * older `ver` (D-9, AC-13). A missing `ver` reads as `0`, so tokens issued
   * before this shipped stay valid until their own `exp` rather than signing
   * everyone out on deploy.
   * @param payload - The decoded, signature-verified token payload.
   * @returns The authenticated user identity.
   * @throws UnauthorizedException if the account is gone, or the token's
   *   version no longer matches the account's.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.queryBus.execute<FindUserByIdQuery, User | null>(
      new FindUserByIdQuery(payload.sub),
    );

    // A deleted account's token used to stay valid until it expired; the same
    // lookup closes that too.
    if (!user || (payload.ver ?? 0) !== user.tokenVersion) {
      throw new UnauthorizedException();
    }

    return { userId: payload.sub, email: payload.email };
  }
}
