import { Injectable, PipeTransform } from '@nestjs/common';
import { FileTypeService } from '../../storage/file-type.service';

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
 * D-6's third gate: content detection, running after multer has staged the
 * bytes and before the handler — so no row exists when it refuses.
 */
@Injectable()
export class AvatarFilePipe implements PipeTransform<
  StagedAvatarUpload | undefined
> {
  /** @param _fileTypeService - Detects the staged file's real type. */
  constructor(private readonly _fileTypeService: FileTypeService) {}

  /**
   * @param _file - The staged upload, or `undefined` when the request
   * carried no `avatar` part.
   * @returns The upload, carrying its detected type.
   * @throws Error until the implementation lands.
   */
  /* eslint-disable @typescript-eslint/no-unused-vars -- red skeleton; the implementing commit detects the staged file's type */
  transform(
    _file: StagedAvatarUpload | undefined,
  ): Promise<CheckedAvatarUpload> {
    throw new Error('Not implemented');
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}
