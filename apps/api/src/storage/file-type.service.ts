import { Injectable } from '@nestjs/common';

/** The result of a successful type detection. */
export interface DetectedFileType {
  /** The accepted MIME type this file was determined to be. */
  mime: string;
}

/**
 * Determines a file's real type from its content, for whichever caller asks:
 * the accepted set travels in as a parameter, so the meeting-files module's
 * twelve types and the profile module's three images share one detector
 * rather than two (D-4).
 */
@Injectable()
export class FileTypeService {
  /**
   * Detects `tempPath`'s real type, never trusting the client's declared
   * `Content-Type` or the file's extension for anything but the text-only
   * fallback.
   * @param _tempPath - Absolute path of the file multer wrote to disk.
   * @param _declaredName - The client-supplied file name, used only to read
   * its extension for the text-content fallback.
   * @param _acceptedMimeTypes - The caller's accepted types, keyed by
   * extension.
   * @returns The detected type when it is one the caller accepts, or `null`
   * when it is not.
   * @throws Error until the implementation lands.
   */
  /* eslint-disable @typescript-eslint/no-unused-vars -- red skeleton; the implementing commit reads all three */
  detect(
    _tempPath: string,
    _declaredName: string,
    _acceptedMimeTypes: ReadonlyMap<string, string>,
  ): Promise<DetectedFileType | null> {
    throw new Error('Not implemented');
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}
