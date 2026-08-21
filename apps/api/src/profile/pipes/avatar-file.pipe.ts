import { rm } from 'fs/promises';
import {
  BadRequestException,
  Injectable,
  PipeTransform,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { FileTypeService } from '../../storage/file-type.service';
import {
  ACCEPTED_AVATAR_MIME_TYPES,
  MISSING_AVATAR_MESSAGE,
  UNSUPPORTED_AVATAR_TYPE_MESSAGE,
} from '../profile.constants';

/** The staged upload multer hands the route, before any type check. */
export interface StagedAvatarUpload {
  /** Absolute path of the temp file multer wrote. */
  path: string;
  /** The client-supplied file name — never trusted for the type. */
  originalname: string;
  /** The client-declared content type — never trusted either. */
  mimetype: string;
  /** The staged file's size in bytes. */
  size: number;
}

/** The checked upload the service commits: its type is the detected one. */
export interface CheckedAvatarUpload {
  /** Absolute path of the temp file to commit. */
  path: string;
  /** The **detected** MIME type, which is what reaches the column. */
  mimetype: string;
  /** The staged file's size in bytes. */
  size: number;
}

/**
 * D-6's third gate: content detection. It runs after multer has staged the
 * bytes and before the handler, so a file whose content contradicts its name
 * is refused with a 415 while no row exists yet and the caller's current
 * avatar is still whatever it was (AC-8). The temp file is unlinked before
 * the throw, so a refusal leaves nothing on disk either.
 */
@Injectable()
export class AvatarFilePipe implements PipeTransform<
  StagedAvatarUpload | undefined
> {
  /** @param fileTypeService - Detects the staged file's real type. */
  constructor(private readonly fileTypeService: FileTypeService) {}

  /**
   * @param file - The staged upload, or `undefined` when the request carried
   * no `avatar` part.
   * @returns The upload, carrying its **detected** type rather than the
   * declared one.
   * @throws BadRequestException if the request carried no avatar part.
   * @throws UnsupportedMediaTypeException if the content is not one of {@link ACCEPTED_AVATAR_MIME_TYPES}.
   */
  async transform(
    file: StagedAvatarUpload | undefined,
  ): Promise<CheckedAvatarUpload> {
    if (!file) {
      throw new BadRequestException(MISSING_AVATAR_MESSAGE);
    }

    const detected = await this.fileTypeService.detect(
      file.path,
      file.originalname,
      ACCEPTED_AVATAR_MIME_TYPES,
    );
    if (!detected) {
      await rm(file.path, { force: true });
      throw new UnsupportedMediaTypeException(UNSUPPORTED_AVATAR_TYPE_MESSAGE);
    }

    // The detected type, never the declared one, is what the column gets —
    // otherwise a caller could label a PNG `image/svg+xml` and have that
    // travel back out as the served `Content-Type` (D-6, D-8).
    return { path: file.path, mimetype: detected.mime, size: file.size };
  }
}
