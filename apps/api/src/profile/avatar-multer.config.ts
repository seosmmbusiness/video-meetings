import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

/**
 * Builds the multer options for the avatar upload route.
 * @returns Multer options for `FileInterceptor('avatar', ...)`.
 * @throws Error until the implementation lands.
 */
export function buildAvatarMulterOptions(): MulterOptions {
  throw new Error('Not implemented');
}
