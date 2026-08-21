import { rm } from 'fs/promises';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { MulterError } from 'multer';
import { AVATAR_SIZE_LIMIT_MESSAGE } from '../profile.constants';

/**
 * D-6's second gate, on the way out: maps a {@link MulterError} raised by
 * `FileInterceptor` — which runs after {@link AvatarSizeGuard}'s
 * declared-size gate has already passed, so this is the chunked-body case —
 * to the same 413 the guard answers, and makes sure no temp file survives
 * the refusal (AC-7).
 *
 * Multer already unlinks what it wrote on a `LIMIT_FILE_SIZE` abort
 * (`removeUploadedFiles`); the unlink here is defensive, for whatever multer
 * version or code path might not.
 */
@Catch(MulterError)
export class AvatarMulterExceptionFilter implements ExceptionFilter {
  /**
   * @param exception - The multer error to translate.
   * @param host - Gives access to the underlying request/response.
   */
  async catch(exception: MulterError, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (request.file?.path) {
      await rm(request.file.path, { force: true });
    }

    if (exception.code === 'LIMIT_FILE_SIZE') {
      response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        message: AVATAR_SIZE_LIMIT_MESSAGE,
      });
      return;
    }

    response
      .status(HttpStatus.BAD_REQUEST)
      .json({ statusCode: HttpStatus.BAD_REQUEST, message: exception.message });
  }
}
