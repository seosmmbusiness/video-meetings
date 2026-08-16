import { readdir, rm, stat } from 'fs/promises';
import { join } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PURGE_AFTER_MS } from './files.constants';
import { FileStorage } from './storage/file-storage';
import { resolveStorageRoot } from './storage/storage-root';

/** Longest a leftover upload temp file may sit unattended before this service removes it (24 hours). */
const STALE_TEMP_FILE_MS = 86_400_000;

/**
 * Purges soft-deleted files whose 30-day retention window has passed —
 * deleting bytes then the row, per file (D-8) — and sweeps
 * `<STORAGE_ROOT>/tmp` of any leftover upload temp file older than 24
 * hours. Runs hourly via `@Cron`; also an ordinary public method, so a test
 * can call it directly after backdating `deletedAt` rather than waiting
 * for a tick.
 */
@Injectable()
export class FilesPurgeService {
  private readonly logger = new Logger(FilesPurgeService.name);

  /**
   * @param prisma - Used to find and delete expired rows.
   * @param fileStorage - Used to delete each expired file's bytes, keyed by
   * its storage key rather than by scanning directories.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileStorage: FileStorage,
  ) {}

  /**
   * Deletes every soft-deleted file past its 30-day purge horizon (bytes
   * first, then its row, so a crash between the two leaves an orphaned row
   * rather than orphaned bytes — an idempotent re-run cleans it up) and
   * sweeps stale upload temp files. Logs only a count, never a filename.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpired(): Promise<void> {
    const horizon = new Date(Date.now() - PURGE_AFTER_MS);
    const expired = await this.prisma.meetingFile.findMany({
      where: { deletedAt: { lt: horizon } },
    });

    for (const file of expired) {
      await this.fileStorage.delete(file.storageKey);
      await this.prisma.meetingFile.delete({ where: { id: file.id } });
    }

    const staleTempFiles = await this.purgeStaleTempFiles();
    this.logger.log(
      `Purged ${expired.length} expired file(s), ${staleTempFiles} stale temp file(s)`,
    );
  }

  /**
   * Removes any file left directly under `<STORAGE_ROOT>/tmp` for longer
   * than {@link STALE_TEMP_FILE_MS} — a crashed or interrupted upload's
   * leftover; a committed file lives under its own `meetings/<id>/` key,
   * never under `tmp`.
   * @returns The number of files removed.
   */
  private async purgeStaleTempFiles(): Promise<number> {
    const tempDir = join(resolveStorageRoot(), 'tmp');
    const entries = await readdir(tempDir);
    let removed = 0;
    for (const entry of entries) {
      if (entry === '.gitkeep') {
        continue;
      }
      const path = join(tempDir, entry);
      const stats = await stat(path);
      if (Date.now() - stats.mtimeMs > STALE_TEMP_FILE_MS) {
        await rm(path, { force: true });
        removed += 1;
      }
    }
    return removed;
  }
}
