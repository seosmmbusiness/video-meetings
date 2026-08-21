import { randomUUID } from 'crypto';
import { diskStorage } from 'multer';
import { join } from 'path';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { resolveStorageRoot } from '../storage/storage-root';
import { MAX_AVATAR_BYTES } from './profile.constants';

/**
 * Builds the multer options for the avatar upload route: writes to
 * `<STORAGE_ROOT>/tmp` under a random filename, and caps the request at one
 * file of {@link MAX_AVATAR_BYTES} — D-6's second gate, which is what stops
 * a chunked body that declared no `Content-Length` for
 * {@link AvatarSizeGuard} to weigh.
 *
 * Extra non-file parts are left to be ignored rather than refused: an
 * upload naming another account in a stray field changes nothing, because
 * the route takes its subject from the token alone (AC-15).
 *
 * The `destination` callback resolves `STORAGE_ROOT` lazily, at request
 * time — not eagerly here — because this function runs once, at
 * `ProfileController`'s decoration time, which happens while `AppModule`'s
 * imports are still being resolved and before `ConfigModule.forRoot()` has
 * loaded the root `.env`.
 * @returns Multer options for `FileInterceptor('avatar', ...)`.
 */
export function buildAvatarMulterOptions(): MulterOptions {
  return {
    storage: diskStorage({
      destination: (_req, _file, callback) => {
        callback(null, join(resolveStorageRoot(), 'tmp'));
      },
      filename: (_req, _file, callback) => {
        callback(null, randomUUID());
      },
    }),
    limits: { fileSize: MAX_AVATAR_BYTES, files: 1 },
    // multer defaults to latin1 for multipart field/file names, which
    // mangles every non-ASCII (e.g. Cyrillic) file name.
    defParamCharset: 'utf8',
  };
}
