import {
  CanActivate,
  ExecutionContext,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  AVATAR_IDLE_TIMEOUT_MS,
  AVATAR_SIZE_LIMIT_MESSAGE,
  MAX_AVATAR_BYTES,
} from '../profile.constants';

/**
 * The first of D-6's three gates: what the avatar upload route decides
 * **before** `FileInterceptor` is allowed to read a single byte off the body
 * — guards run before interceptors, which is what makes this the right layer
 * for both:
 *
 * 1. Refuse a declared `Content-Length` over {@link MAX_AVATAR_BYTES} at
 *    zero bytes read (AC-7). Multer's own `limits.fileSize`, and
 *    {@link AvatarMulterExceptionFilter}, are the fallback for a chunked
 *    request that declares nothing.
 * 2. Arm an inactivity timeout: a body that goes idle for
 *    {@link AVATAR_IDLE_TIMEOUT_MS} is destroyed, while a slow-but-steady
 *    transfer runs to completion untouched.
 *
 * There is no quota gate here — unlike a meeting file, an avatar sits
 * outside the per-owner byte accounting, because there is at most one per
 * account and D-5 keeps it out of that ledger.
 */
@Injectable()
export class AvatarSizeGuard implements CanActivate {
  /**
   * @param context - The current execution context.
   * @returns `true` once the declared size is within the ceiling.
   * @throws PayloadTooLargeException if the declared size exceeds {@link MAX_AVATAR_BYTES}.
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (this.declaredBytes(request) > MAX_AVATAR_BYTES) {
      throw new PayloadTooLargeException(AVATAR_SIZE_LIMIT_MESSAGE);
    }

    request.setTimeout(AVATAR_IDLE_TIMEOUT_MS, () => request.destroy());

    return true;
  }

  /**
   * Reads the request's declared size. A chunked request declares no
   * `Content-Length`, so it is treated as the ceiling — the most any single
   * avatar could legally be — rather than as zero, which would wave it
   * through this gate on a technicality.
   * @param request - The incoming request, not yet streamed.
   * @returns The declared byte count.
   */
  private declaredBytes(request: Request): number {
    const header = request.headers['content-length'];
    const parsed = header === undefined ? NaN : Number(header);
    return Number.isFinite(parsed) ? parsed : MAX_AVATAR_BYTES;
  }
}
