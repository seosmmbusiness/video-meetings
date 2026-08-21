import { mkdtemp, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  BadRequestException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { FileTypeService } from '../../storage/file-type.service';
import {
  ACCEPTED_AVATAR_MIME_TYPES,
  UNSUPPORTED_AVATAR_TYPE_MESSAGE,
} from '../profile.constants';
import { AvatarFilePipe } from './avatar-file.pipe';

/**
 * Builds a stub {@link FileTypeService} whose `detect` resolves to `mime`,
 * or to `null` for content outside the accepted set.
 * @param mime - The MIME type detection should report, or `null`.
 * @returns The stub service plus the `detect` mock as its own handle.
 */
function buildDetector(mime: string | null) {
  const detect = jest
    .fn()
    .mockResolvedValue(mime === null ? null : { mime })
    .mockName('detect');
  const service = { detect } as unknown as FileTypeService;
  return { service, detect };
}

describe('AvatarFilePipe', () => {
  let dir: string;
  let tempPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'up-avatar-pipe-'));
    tempPath = join(dir, 'staged');
    await writeFile(tempPath, 'staged bytes');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /**
   * The staged upload multer hands the pipe, with a declared type the pipe
   * must not trust.
   * @param declared - The client-declared MIME type and file name.
   * @returns A multer-shaped staged file.
   */
  function stagedFile(declared = { mimetype: 'image/png', name: 'a.png' }) {
    return {
      path: tempPath,
      originalname: declared.name,
      mimetype: declared.mimetype,
      size: 2048,
    };
  }

  it("detects the type from content, against the profile's own accepted set (D-4)", async () => {
    const { service, detect } = buildDetector('image/png');
    const pipe = new AvatarFilePipe(service);

    await pipe.transform(stagedFile());

    expect(detect).toHaveBeenCalledWith(
      tempPath,
      'a.png',
      ACCEPTED_AVATAR_MIME_TYPES,
    );
  });

  it('passes the detected type on, never the declared one (AC-8)', async () => {
    const { service } = buildDetector('image/webp');
    const pipe = new AvatarFilePipe(service);

    const file = await pipe.transform(
      stagedFile({ mimetype: 'image/png', name: 'lying.png' }),
    );

    expect(file).toEqual({
      path: tempPath,
      mimetype: 'image/webp',
      size: 2048,
    });
  });

  it('refuses content outside the accepted set with the verbatim 415 message (AC-8)', async () => {
    const { service } = buildDetector(null);
    const pipe = new AvatarFilePipe(service);

    await expect(
      pipe.transform(stagedFile({ mimetype: 'image/png', name: 'a.png' })),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    await expect(
      pipe.transform(stagedFile({ mimetype: 'image/png', name: 'a.png' })),
    ).rejects.toThrow(UNSUPPORTED_AVATAR_TYPE_MESSAGE);
  });

  it('unlinks the staged temp file before refusing, so a refusal leaves nothing behind (AC-8)', async () => {
    const { service } = buildDetector(null);
    const pipe = new AvatarFilePipe(service);

    await expect(pipe.transform(stagedFile())).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );

    await expect(stat(tempPath)).rejects.toThrow();
  });

  it('leaves the staged file in place when the content is accepted', async () => {
    const { service } = buildDetector('image/png');
    const pipe = new AvatarFilePipe(service);

    await pipe.transform(stagedFile());

    await expect(stat(tempPath)).resolves.toBeDefined();
  });

  it('refuses a request carrying no avatar part at all', async () => {
    const { service, detect } = buildDetector('image/png');
    const pipe = new AvatarFilePipe(service);

    await expect(pipe.transform(undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(detect).not.toHaveBeenCalled();
  });
});
