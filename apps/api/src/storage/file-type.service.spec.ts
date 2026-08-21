import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ACCEPTED_MIME_TYPES } from '../files/files.constants';
import { FileTypeService } from './file-type.service';

/**
 * The three types the profile module accepts, passed exactly as `profile`
 * passes them (D-4) — the point of the parameter is that this set and the
 * meeting-files set travel through the same detector.
 */
const ACCEPTED_AVATAR_MIME_TYPES: ReadonlyMap<string, string> = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['webp', 'image/webp'],
]);

/**
 * A minimal but structurally valid PNG: the 8-byte signature, a well-formed
 * 13-byte `IHDR` chunk (file-type parses its length before trusting the
 * signature) and an empty `IDAT` chunk, which is what file-type's PNG
 * scanner reads before it will report `image/png`.
 * @returns The PNG byte sequence.
 */
function pngBytes(): Buffer {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const ihdrData = Buffer.alloc(13);
  const ihdrChunk = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x0d]), // length: 13
    Buffer.from('IHDR', 'latin1'),
    ihdrData,
    Buffer.alloc(4), // CRC, not validated by the detector
  ]);
  const idatChunk = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x00]), // length: 0
    Buffer.from('IDAT', 'latin1'),
    Buffer.alloc(4), // CRC, not validated by the detector
  ]);
  return Buffer.concat([signature, ihdrChunk, idatChunk]);
}

/**
 * A RIFF container declaring the `WEBP` form type, which is what the content
 * detector matches on.
 * @returns The WebP byte sequence.
 */
function webpBytes(): Buffer {
  const payload = Buffer.concat([
    Buffer.from('WEBPVP8 ', 'latin1'),
    Buffer.alloc(16),
  ]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(payload.length, 0);
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), size, payload]);
}

/**
 * A real PDF header — detectable, accepted by the meeting-files set and
 * deliberately outside the avatar set, which is what makes it AC-8's case.
 * @returns The PDF byte sequence.
 */
function pdfBytes(): Buffer {
  return Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n', 'latin1');
}

/** `GIF89a` signature — a real, detectable format that isn't in the accepted list. */
const GIF_SIGNATURE = Buffer.from('GIF89a');

describe('FileTypeService', () => {
  let dir: string;
  const service = new FileTypeService();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mfu-filetype-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /**
   * Writes `bytes` to a fresh temp file and returns its path.
   * @param bytes - The file content to write.
   * @returns The temp file's absolute path.
   */
  async function tempFile(bytes: Buffer): Promise<string> {
    const path = join(dir, 'sample');
    await writeFile(path, bytes);
    return path;
  }

  describe("the meeting-files module's twelve accepted types", () => {
    it('detects a PNG by its signature, regardless of the declared name', async () => {
      const path = await tempFile(pngBytes());

      const detected = await service.detect(
        path,
        'anything.bin',
        ACCEPTED_MIME_TYPES,
      );

      expect(detected).toEqual({ mime: 'image/png' });
    });

    it('rejects a detectable type outside the accepted list (a GIF), regardless of a renamed extension (AC-6)', async () => {
      const path = await tempFile(
        Buffer.concat([GIF_SIGNATURE, Buffer.from('...')]),
      );

      const detected = await service.detect(
        path,
        'looks-like.pdf',
        ACCEPTED_MIME_TYPES,
      );

      expect(detected).toBeNull();
    });

    it('accepts a .txt file whose content is clean UTF-8 text', async () => {
      const path = await tempFile(Buffer.from('hello, this is plain text\n'));

      const detected = await service.detect(
        path,
        'notes.txt',
        ACCEPTED_MIME_TYPES,
      );

      expect(detected).toEqual({ mime: 'text/plain' });
    });

    it('accepts a .md file whose content is clean UTF-8 text', async () => {
      const path = await tempFile(Buffer.from('# heading\n\nsome markdown\n'));

      const detected = await service.detect(
        path,
        'notes.md',
        ACCEPTED_MIME_TYPES,
      );

      expect(detected).toEqual({ mime: 'text/markdown' });
    });

    it('rejects a NUL-bearing blob named .txt', async () => {
      const path = await tempFile(Buffer.from([0x68, 0x69, 0x00, 0x68, 0x69]));

      const detected = await service.detect(
        path,
        'notes.txt',
        ACCEPTED_MIME_TYPES,
      );

      expect(detected).toBeNull();
    });

    it('rejects a C0-control-bearing blob named .md (control byte outside tab/LF/CR)', async () => {
      const path = await tempFile(Buffer.from([0x68, 0x69, 0x07, 0x68, 0x69]));

      const detected = await service.detect(
        path,
        'notes.md',
        ACCEPTED_MIME_TYPES,
      );

      expect(detected).toBeNull();
    });

    it('rejects an undetected blob with an unaccepted extension, even when its content is plain text', async () => {
      const path = await tempFile(
        Buffer.from('plain text with no known signature at all'),
      );

      const detected = await service.detect(
        path,
        'archive.dat',
        ACCEPTED_MIME_TYPES,
      );

      expect(detected).toBeNull();
    });
  });

  describe("the profile module's three accepted image types (D-4)", () => {
    it('accepts a PNG, a JPEG and a WebP by their content', async () => {
      const png = await tempFile(pngBytes());
      await expect(
        service.detect(png, 'a.png', ACCEPTED_AVATAR_MIME_TYPES),
      ).resolves.toEqual({ mime: 'image/png' });

      const webp = await tempFile(webpBytes());
      await expect(
        service.detect(webp, 'a.webp', ACCEPTED_AVATAR_MIME_TYPES),
      ).resolves.toEqual({ mime: 'image/webp' });
    });

    it('rejects a PDF renamed .png — a type the files module accepts and this one does not (AC-8)', async () => {
      const path = await tempFile(pdfBytes());

      const asFile = await service.detect(
        path,
        'not-really.png',
        ACCEPTED_MIME_TYPES,
      );
      const asAvatar = await service.detect(
        path,
        'not-really.png',
        ACCEPTED_AVATAR_MIME_TYPES,
      );

      // Same bytes, same name, two callers: only the accepted set differs,
      // which is exactly what the parameter exists for (D-4).
      expect(asFile).toEqual({ mime: 'application/pdf' });
      expect(asAvatar).toBeNull();
    });

    it('rejects clean text named .txt, because no text type is in this accepted set', async () => {
      const path = await tempFile(Buffer.from('hello, this is plain text\n'));

      const detected = await service.detect(
        path,
        'notes.txt',
        ACCEPTED_AVATAR_MIME_TYPES,
      );

      expect(detected).toBeNull();
    });
  });
});
