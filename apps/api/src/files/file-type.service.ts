import { open } from 'fs/promises';
import { extname } from 'path';
import { Injectable } from '@nestjs/common';
import { loadEsm } from 'load-esm';
import {
  ACCEPTED_MIME_TYPES,
  TEXT_FILE_EXTENSIONS,
  TYPE_SNIFF_SAMPLE_BYTES,
} from './files.constants';

/** The result of a successful type detection. */
export interface DetectedFileType {
  /** The accepted MIME type this file was determined to be. */
  mime: string;
}

const MIME_BY_TEXT_EXTENSION: Readonly<Record<string, string>> = {
  txt: 'text/plain',
  md: 'text/markdown',
};

/** The set of MIME types `file-type` may return that this feature accepts. */
const ACCEPTED_MIME_VALUES = new Set(ACCEPTED_MIME_TYPES.values());

/**
 * Checks whether `sample` is safe to accept as plain text: valid UTF-8, no
 * NUL byte, and no C0 control byte other than tab/LF/CR — the same rule D-2
 * uses to tell a real `txt`/`md` file from an arbitrary binary that merely
 * carries no signature `file-type` recognizes.
 * @param sample - The first bytes of the temp file.
 * @returns `true` when the sample reads as clean text.
 */
function looksLikeText(sample: Buffer): boolean {
  for (const byte of sample) {
    const isC0Control = byte < 0x20;
    const isAllowedControl = byte === 0x09 || byte === 0x0a || byte === 0x0d;
    if (isC0Control && !isAllowedControl) {
      return false;
    }
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

/**
 * Determines a file's real type from its content, per D-2: `file-type`'s
 * signature detection first, falling back to the text-content rule only for
 * the two extensions (`txt`, `md`) that carry no signature at all.
 */
@Injectable()
export class FileTypeService {
  /**
   * Detects `tempPath`'s real type, never trusting the client's declared
   * `Content-Type` or the file's extension for anything but the text-only
   * fallback.
   * @param tempPath - Absolute path of the file multer wrote to disk.
   * @param declaredName - The client-supplied file name, used only to read
   * its extension for the text-content fallback.
   * @returns The detected type when it is one of the twelve accepted
   * types, or `null` when it is not.
   */
  async detect(
    tempPath: string,
    declaredName: string,
  ): Promise<DetectedFileType | null> {
    // file-type is ESM-only; apps/api's CommonJS build reaches it through
    // load-esm's dynamic import, which needs --experimental-vm-modules under
    // Jest (apps/api/package.json's test/test:e2e scripts).
    const { fileTypeFromFile } =
      await loadEsm<typeof import('file-type')>('file-type');
    const detected = await fileTypeFromFile(tempPath);

    if (detected) {
      return ACCEPTED_MIME_VALUES.has(detected.mime)
        ? { mime: detected.mime }
        : null;
    }

    const extension = extname(declaredName).slice(1).toLowerCase();
    if (!TEXT_FILE_EXTENSIONS.has(extension)) {
      return null;
    }
    const sample = await this.readSample(tempPath);
    return looksLikeText(sample)
      ? { mime: MIME_BY_TEXT_EXTENSION[extension] }
      : null;
  }

  /**
   * Reads up to {@link TYPE_SNIFF_SAMPLE_BYTES} from the start of `tempPath`.
   * @param tempPath - Absolute path of the file to sample.
   * @returns The bytes read (fewer than the sample size for a short file).
   */
  private async readSample(tempPath: string): Promise<Buffer> {
    const handle = await open(tempPath, 'r');
    try {
      const buffer = Buffer.alloc(TYPE_SNIFF_SAMPLE_BYTES);
      const { bytesRead } = await handle.read(
        buffer,
        0,
        TYPE_SNIFF_SAMPLE_BYTES,
        0,
      );
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }
}
