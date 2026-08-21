import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

/**
 * The first of D-6's three gates: everything the avatar upload route must
 * decide **before** `FileInterceptor` reads a byte off the body.
 */
@Injectable()
export class AvatarSizeGuard implements CanActivate {
  /**
   * @param _context - The current execution context.
   * @returns `true` once the declared size is within the ceiling.
   * @throws Error until the implementation lands.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- red skeleton; the implementing commit reads the request off it
  canActivate(_context: ExecutionContext): boolean {
    throw new Error('Not implemented');
  }
}
