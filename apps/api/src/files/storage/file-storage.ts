import { Readable } from 'stream';

/**
 * Backend-agnostic boundary for file bytes: everything in `apps/api` that
 * reads, writes or deletes a file's bytes goes through this class, keyed by
 * a backend-agnostic storage key rather than a filesystem path. Bound as its
 * own Nest injection token; {@link LocalDiskFileStorage} is the only
 * implementation today.
 */
export abstract class FileStorage {
  /**
   * Commits an already-written temp file under `key`.
   * @param key - Backend-agnostic storage key, e.g. `meetings/<id>/<fileId>`.
   * @param tempPath - Absolute path of the temp file to commit.
   */
  abstract save(key: string, tempPath: string): Promise<void>;

  /**
   * Opens a read stream for the bytes stored under `key`.
   * @param key - The storage key to read.
   * @param range - Optional inclusive byte range to read.
   * @returns A readable stream of the file's bytes.
   */
  abstract createReadStream(
    key: string,
    range?: { start: number; end: number },
  ): Readable;

  /**
   * Deletes the bytes stored under `key`, if present.
   * @param key - The storage key to delete.
   */
  abstract delete(key: string): Promise<void>;

  /**
   * Returns the size of the bytes stored under `key`.
   * @param key - The storage key to inspect.
   * @returns The file's size, or `null` if it does not exist.
   */
  abstract stat(key: string): Promise<{ size: number } | null>;

  /**
   * Absolute local filesystem path for `key`, when this backend has one.
   * @param key - The storage key.
   * @returns The absolute path, or `null` for a backend with no local path
   * (e.g. a future remote object store).
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- part of the shared signature every subclass overrides
  localPathFor(key: string): string | null {
    return null;
  }
}
