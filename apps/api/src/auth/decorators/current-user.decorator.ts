import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '../strategies/jwt.strategy';

/**
 * Extracts the authenticated user (set by {@link JwtAuthGuard}) from the
 * request.
 * @param _data - Unused; required by the `createParamDecorator` signature.
 * @param context - The current execution context.
 * @returns The authenticated user identity.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context
      .switchToHttp()
      .getRequest<{ user: AuthenticatedUser }>();
    return request.user;
  },
);
