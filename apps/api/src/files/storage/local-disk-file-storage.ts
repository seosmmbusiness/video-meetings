import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'fs';
import { chmod, mkdir, rename, rm, stat } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { Readable } from 'stream';
import { FileStorage } from './file-storage';

const DEV_DEFAULT_STORAGE_ROOT = join(process.cwd(), '../../.data/uploads');
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * Local-disk implementation of {@link FileStorage}. Files live under a
 * configured root directory (`STORAGE_ROOT`), keyed by a backend-agnostic
 * storage key; an upload is written to `<root>/tmp` first and committed with
 * a same-filesystem rename.
 */
@Injectable()
export class LocalDiskFileStorage extends FileStorage implements OnModuleInit {
  private readonly root: string;

  /**
   * @param config - Used to resolve `STORAGE_ROOT`, required outside
   * development so a missing path fails startup loudly rather than writing
   * user files into the checkout.
   * @throws Error if `STORAGE_ROOT` is unset while `NODE_ENV` is `production`.
   */
  constructor(config: ConfigService) {
    super();
    const isProduction = config.get<string>('NODE_ENV') === 'production';
    const configuredRoot = isProduction
      ? config.getOrThrow<string>('STORAGE_ROOT')
      : (config.get<string>('STORAGE_ROOT') ?? DEV_DEFAULT_STORAGE_ROOT);
    this.root = resolve(configuredRoot);
  }

  /** Directory temp uploads are written to before being committed. */
  private get tempDir(): string {
    return join(this.root, 'tmp');
  }

  /** Creates the storage root and its temp directory, both mode `0o700`. */
  async onModuleInit(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: DIRECTORY_MODE });
    await mkdir(this.tempDir, { recursive: true, mode: DIRECTORY_MODE });
  }

  private pathFor(key: string): string {
    return join(this.root, key);
  }

  /**
   * Commits an already-written temp file under `key`: creates its parent
   * directory, renames the temp file into place (same filesystem, so this is
   * atomic), and locks its mode down to `0o600`.
   * @param key - Backend-agnostic storage key, e.g. `meetings/<id>/<fileId>`.
   * @param tempPath - Absolute path of the temp file to commit.
   */
  async save(key: string, tempPath: string): Promise<void> {
    const dest = this.pathFor(key);
    await mkdir(dirname(dest), { recursive: true, mode: DIRECTORY_MODE });
    await rename(tempPath, dest);
    await chmod(dest, FILE_MODE);
  }

  /**
   * Opens a read stream for the bytes stored under `key`.
   * @param key - The storage key to read.
   * @param range - Optional inclusive byte range to read.
   * @returns A readable stream of the file's bytes.
   */
  createReadStream(
    key: string,
    range?: { start: number; end: number },
  ): Readable {
    return createReadStream(this.pathFor(key), range);
  }

  /**
   * Deletes the bytes stored under `key`, if present.
   * @param key - The storage key to delete.
   */
  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  /**
   * Returns the size of the bytes stored under `key`.
   * @param key - The storage key to inspect.
   * @returns The file's size, or `null` if it does not exist.
   */
  async stat(key: string): Promise<{ size: number } | null> {
    try {
      const stats = await stat(this.pathFor(key));
      return { size: stats.size };
    } catch {
      return null;
    }
  }

  /**
   * Absolute local path for `key` — always available for this backend.
   * @param key - The storage key.
   * @returns The absolute filesystem path.
   */
  override localPathFor(key: string): string {
    return this.pathFor(key);
  }
}
