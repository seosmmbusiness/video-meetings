import { buildAvatarMulterOptions } from './avatar-multer.config';
import { MAX_AVATAR_BYTES } from './profile.constants';

describe('buildAvatarMulterOptions', () => {
  const originalRoot = process.env.STORAGE_ROOT;

  afterEach(() => {
    if (originalRoot === undefined) {
      delete process.env.STORAGE_ROOT;
      return;
    }
    process.env.STORAGE_ROOT = originalRoot;
  });

  it('caps a single file at the 5 MB ceiling, which is what catches a chunked body (D-6)', () => {
    const options = buildAvatarMulterOptions();

    expect(options.limits?.fileSize).toBe(MAX_AVATAR_BYTES);
    expect(options.limits?.files).toBe(1);
  });

  it('reads STORAGE_ROOT at request time, not at decoration time', () => {
    delete process.env.STORAGE_ROOT;
    // Built while STORAGE_ROOT is unset, exactly as it is at controller
    // decoration time — before ConfigModule has loaded the root .env.
    const options = buildAvatarMulterOptions();
    process.env.STORAGE_ROOT = '/tmp/up-avatar-root';

    const destination = jest.fn();
    (
      options.storage as unknown as {
        getDestination: (
          req: unknown,
          file: unknown,
          cb: (error: Error | null, path: string) => void,
        ) => void;
      }
    ).getDestination({}, {}, destination);

    expect(destination).toHaveBeenCalledWith(null, '/tmp/up-avatar-root/tmp');
  });

  it('keeps multipart names in UTF-8 rather than multer’s latin1 default', () => {
    expect(buildAvatarMulterOptions().defParamCharset).toBe('utf8');
  });
});
