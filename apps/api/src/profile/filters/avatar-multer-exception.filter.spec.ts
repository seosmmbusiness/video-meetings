import { mkdtemp, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ArgumentsHost } from '@nestjs/common';
import { MulterError } from 'multer';
import { AVATAR_SIZE_LIMIT_MESSAGE } from '../profile.constants';
import { AvatarMulterExceptionFilter } from './avatar-multer-exception.filter';

/**
 * Builds a stub `ArgumentsHost` exposing a fake request (optionally carrying
 * a multer `file`) and a `Response` whose `status`/`json` calls are captured
 * for assertions.
 * @param filePath - Path to put on `request.file.path`, or `undefined`.
 * @returns The stub host plus the captured response calls.
 */
function buildHost(filePath: string | undefined) {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const response = { status };
  const request = filePath ? { file: { path: filePath } } : {};
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AvatarMulterExceptionFilter', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'up-avatar-filter-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("maps LIMIT_FILE_SIZE to the guard's own 413 message (AC-7)", async () => {
    const filter = new AvatarMulterExceptionFilter();
    const { host, status, json } = buildHost(undefined);

    await filter.catch(new MulterError('LIMIT_FILE_SIZE'), host);

    // Gate 2 answers exactly what gate 1 answers, so a chunked body and a
    // declared one are indistinguishable to the caller (D-6).
    expect(status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 413,
        message: AVATAR_SIZE_LIMIT_MESSAGE,
      }),
    );
  });

  it('unlinks a temp file still present on the request, so a refusal stores nothing (AC-7)', async () => {
    const filePath = join(dir, 'leftover');
    await writeFile(filePath, 'partial upload');
    const filter = new AvatarMulterExceptionFilter();
    const { host } = buildHost(filePath);

    await filter.catch(new MulterError('LIMIT_FILE_SIZE'), host);

    await expect(stat(filePath)).rejects.toThrow();
  });

  it('maps any other multer error to 400 with its own message', async () => {
    const filter = new AvatarMulterExceptionFilter();
    const { host, status, json } = buildHost(undefined);

    await filter.catch(new MulterError('LIMIT_UNEXPECTED_FILE'), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Unexpected field' }),
    );
  });
});
