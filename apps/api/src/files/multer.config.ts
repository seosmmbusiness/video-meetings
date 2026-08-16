import { randomUUID } from 'crypto';
import { diskStorage } from 'multer';
import { join } from 'path';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { MAX_FILE_BYTES } from './files.constants';
import { resolveStorageRoot } from './storage/storage-root';

/**
 * Builds the multer options for the upload route: writes to
 * `<STORAGE_ROOT>/tmp` under a random filename, and caps the request to one
 * part carrying one file with no extra fields.
 *
 * The `destination` callback resolves `STORAGE_ROOT` lazily, at request
 * time — not eagerly here — because this function runs once, at
 * `FilesController`'s decoration time, which happens while `AppModule`'s
 * imports are still being resolved and before `ConfigModule.forRoot()` has
 * loaded the root `.env`.
 * @returns Multer options for `FileInterceptor('file', ...)`.
 */
export function buildMulterOptions(): MulterOptions {
  return {
    storage: diskStorage({
      destination: (_req, _file, callback) => {
        callback(null, join(resolveStorageRoot(), 'tmp'));
      },
      filename: (_req, _file, callback) => {
        callback(null, randomUUID());
      },
    }),
    // busboy counts the closing multipart boundary as a "part" of its own
    // (measured: a single file with no other fields needs `parts: 2`, not 1,
    // or busboy emits its `partsLimit` event and multer answers 400).
    limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 0, parts: 2 },
    // multer defaults to latin1 for multipart field/file names, which
    // mangles every non-ASCII (e.g. Cyrillic) file name.
    defParamCharset: 'utf8',
  };
}
