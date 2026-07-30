import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Protects a route behind a valid `Authorization: Bearer <token>` header,
 * verified against the `jwt` Passport strategy.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
