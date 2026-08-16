import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileTypeService } from './file-type.service';

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

  it('detects a PNG by its signature, regardless of the declared name', async () => {
    const path = await tempFile(pngBytes());

    const detected = await service.detect(path, 'anything.bin');

    expect(detected).toEqual({ mime: 'image/png' });
  });

  it('rejects a detectable type outside the accepted list (a GIF), regardless of a renamed extension (AC-6)', async () => {
    const path = await tempFile(
      Buffer.concat([GIF_SIGNATURE, Buffer.from('...')]),
    );

    const detected = await service.detect(path, 'looks-like.pdf');

    expect(detected).toBeNull();
  });

  it('accepts a .txt file whose content is clean UTF-8 text', async () => {
    const path = await tempFile(Buffer.from('hello, this is plain text\n'));

    const detected = await service.detect(path, 'notes.txt');

    expect(detected).toEqual({ mime: 'text/plain' });
  });

  it('accepts a .md file whose content is clean UTF-8 text', async () => {
    const path = await tempFile(Buffer.from('# heading\n\nsome markdown\n'));

    const detected = await service.detect(path, 'notes.md');

    expect(detected).toEqual({ mime: 'text/markdown' });
  });

  it('rejects a NUL-bearing blob named .txt', async () => {
    const path = await tempFile(Buffer.from([0x68, 0x69, 0x00, 0x68, 0x69]));

    const detected = await service.detect(path, 'notes.txt');

    expect(detected).toBeNull();
  });

  it('rejects a C0-control-bearing blob named .md (control byte outside tab/LF/CR)', async () => {
    const path = await tempFile(Buffer.from([0x68, 0x69, 0x07, 0x68, 0x69]));

    const detected = await service.detect(path, 'notes.md');

    expect(detected).toBeNull();
  });

  it('rejects an undetected blob with an unaccepted extension, even when its content is plain text', async () => {
    const path = await tempFile(
      Buffer.from('plain text with no known signature at all'),
    );

    const detected = await service.detect(path, 'archive.dat');

    expect(detected).toBeNull();
  });
});
