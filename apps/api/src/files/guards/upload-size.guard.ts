import {
  CanActivate,
  ExecutionContext,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  FILE_SIZE_LIMIT_MESSAGE,
  MAX_FILE_BYTES,
  UPLOAD_IDLE_TIMEOUT_MS,
} from '../files.constants';
import { QuotaReservationService } from '../quota-reservation.service';

/** Request shape once {@link JwtAuthGuard} has already run. */
interface UploadRequest extends Request {
  user: AuthenticatedUser;
}

/**
 * Everything the upload route must decide **before** `FileInterceptor` is
 * allowed to read a single byte off the body — guards run before
 * interceptors, which is what makes this the right layer for all three:
 *
 * 1. Refuse a declared `Content-Length` over {@link MAX_FILE_BYTES} at zero
 *    bytes read (D-3, task 2.1) — the streamed-size gate inside multer
 *    itself, and {@link MulterExceptionFilter}, are the fallback for a
 *    chunked request that declares nothing.
 * 2. Reserve the declared size against the owner's 20 GB ceiling for the
 *    life of the request (S-3), released once the response finishes,
 *    closing the race where concurrent uploads each pass the same
 *    pre-upload total before any of them commits.
 * 3. Arm an inactivity timeout (S-9): a body that goes idle for
 *    {@link UPLOAD_IDLE_TIMEOUT_MS} is destroyed, while a slow-but-steady
 *    transfer runs to completion untouched.
 */
@Injectable()
export class UploadSizeGuard implements CanActivate {
  /** @param quota - Reserves the declared size against the owner's ceiling. */
  constructor(private readonly quota: QuotaReservationService) {}

  /**
   * @param context - The current execution context.
   * @returns `true` once the size is within the ceiling and the byte
   * reservation succeeded.
   * @throws PayloadTooLargeException if the declared size exceeds {@link MAX_FILE_BYTES}.
   * @throws InsufficientStorageException if reserving the declared size would cross the owner's 20 GB ceiling.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UploadRequest>();
    const response = context.switchToHttp().getResponse<Response>();

    const declaredBytes = this.declaredBytes(request);
    if (declaredBytes > MAX_FILE_BYTES) {
      throw new PayloadTooLargeException(FILE_SIZE_LIMIT_MESSAGE);
    }

    const release = await this.quota.reserve(
      request.user.userId,
      declaredBytes,
    );
    let released = false;
    const releaseOnce = () => {
      if (released) {
        return;
      }
      released = true;
      release();
    };
    response.once('finish', releaseOnce);
    response.once('close', releaseOnce);

    request.setTimeout(UPLOAD_IDLE_TIMEOUT_MS, () => request.destroy());

    return true;
  }

  /**
   * Reads the request's declared size. A chunked request declares no
   * `Content-Length`, so it reserves (and is checked against) the per-file
   * ceiling instead — the most any single upload could legally be.
   * @param request - The incoming request, not yet streamed.
   * @returns The declared byte count.
   */
  private declaredBytes(request: Request): number {
    const header = request.headers['content-length'];
    const parsed = header === undefined ? NaN : Number(header);
    return Number.isFinite(parsed) ? parsed : MAX_FILE_BYTES;
  }
}
