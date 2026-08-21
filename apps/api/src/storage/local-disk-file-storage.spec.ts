import { mkdtemp, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ConfigService } from '@nestjs/config';
import { LocalDiskFileStorage } from './local-disk-file-storage';

/**
 * Builds a stub `ConfigService` that resolves `STORAGE_ROOT` to `root` (or
 * to nothing) and throws on `getOrThrow` for any key, matching how the real
 * `ConfigService` behaves for an unset variable.
 * @param root - The value `get('STORAGE_ROOT')` should resolve to, or
 * `undefined` to simulate it being unset.
 * @returns A minimal stand-in for `ConfigService`.
 */
function stubConfig(root: string | undefined): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'STORAGE_ROOT') return root;
      if (key === 'NODE_ENV') return process.env.NODE_ENV;
      return undefined;
    },
    getOrThrow: (key: string) => {
      if (key === 'STORAGE_ROOT' && root) {
        return root;
      }
      throw new Error(`${key} is not defined`);
    },
  } as unknown as ConfigService;
}

describe('LocalDiskFileStorage', () => {
  let parent: string;
  let root: string;

  beforeEach(async () => {
    parent = await mkdtemp(join(tmpdir(), 'mfu-storage-'));
    // Non-existent subdirectory: proves the mode below is set by mkdir
    // itself, not inherited from a directory mkdtemp already created.
    root = join(parent, 'storage');
  });

  afterEach(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  it('creates the storage root and its temp dir with mode 0o700 (S-5)', async () => {
    const storage = new LocalDiskFileStorage(stubConfig(root));
    await storage.onModuleInit();

    const rootStats = await stat(root);
    const tempStats = await stat(join(root, 'tmp'));
    expect(rootStats.mode & 0o777).toBe(0o700);
    expect(tempStats.mode & 0o777).toBe(0o700);
  });

  it('commits a file with mode 0o600 (S-5)', async () => {
    const storage = new LocalDiskFileStorage(stubConfig(root));
    await storage.onModuleInit();
    const tempPath = join(root, 'tmp', 'incoming');
    await writeFile(tempPath, 'hello');

    await storage.save('meetings/m1/f1', tempPath);

    const stats = await stat(join(root, 'meetings/m1/f1'));
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it('throws at construction when STORAGE_ROOT is absent and NODE_ENV=production (S-5)', () => {
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => new LocalDiskFileStorage(stubConfig(undefined))).toThrow();
    } finally {
      process.env.NODE_ENV = previousEnv;
    }
  });

  it('falls back to the dev default when STORAGE_ROOT is absent outside production', () => {
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      expect(
        () => new LocalDiskFileStorage(stubConfig(undefined)),
      ).not.toThrow();
    } finally {
      process.env.NODE_ENV = previousEnv;
    }
  });
});
