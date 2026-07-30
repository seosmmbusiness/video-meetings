import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

/** Payload encoded in access tokens issued by {@link AuthService}. */
export interface JwtPayload {
  sub: string;
  email: string;
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
   */
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * Maps a verified JWT payload to the shape stored on `Request.user`.
   * @param payload - The decoded, signature-verified token payload.
   * @returns The authenticated user identity.
   */
  validate(payload: JwtPayload): AuthenticatedUser {
    return { userId: payload.sub, email: payload.email };
  }
}
