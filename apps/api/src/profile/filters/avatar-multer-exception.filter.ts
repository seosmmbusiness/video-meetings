import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { MulterError } from 'multer';

/**
 * D-6's second gate, on the way out: maps the {@link MulterError} a chunked
 * body over the ceiling raises to the same 413 the guard answers.
 */
@Catch(MulterError)
export class AvatarMulterExceptionFilter implements ExceptionFilter {
  /**
   * @param _exception - The multer error to translate.
   * @param _host - Gives access to the underlying request/response.
   * @throws Error until the implementation lands.
   */
  /* eslint-disable @typescript-eslint/no-unused-vars -- red skeleton; the implementing commit answers off both */
  catch(_exception: MulterError, _host: ArgumentsHost): Promise<void> {
    throw new Error('Not implemented');
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}
