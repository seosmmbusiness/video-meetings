import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_TOTAL_BYTES_PER_OWNER } from './files.constants';
import { InsufficientStorageException } from './quota';

/**
 * Holds the owner's stored-bytes ceiling for the life of an in-flight
 * upload, closing the race S-3 describes: the persisted total is only
 * updated once a row commits, so without this, concurrent uploads can each
 * pass the same pre-upload total and together blow past
 * {@link MAX_TOTAL_BYTES_PER_OWNER} before any of them commits.
 *
 * Reservations are in-process only (S-3's residual risk on a multi-instance
 * deployment) and per-owner reads/writes are serialized through
 * {@link runExclusive} so two reservations for the same owner can never both
 * observe the persisted total before either has recorded its own declared
 * bytes — the TOCTOU window a plain `await`-then-`Map.set` would leave open.
 */
@Injectable()
export class QuotaReservationService {
  private readonly reservedByOwner = new Map<string, number>();
  private readonly queues = new Map<string, Promise<unknown>>();

  /** @param prisma - Used to read the owner's already-committed byte total. */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs `fn` for `ownerId` only after every previously-queued call for that
   * same owner has settled, so the read-then-write inside {@link reserve}
   * never interleaves with another reservation for the same owner. Calls for
   * different owners never wait on each other.
   * @param ownerId - The owner whose reservations are being serialized.
   * @param fn - The exclusive section to run.
   * @returns Whatever `fn` resolves (or rejects) with.
   */
  private runExclusive<T>(ownerId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(ownerId) ?? Promise.resolve();
    const settled = previous.then(fn, fn);
    this.queues.set(
      ownerId,
      settled.then(
        () => undefined,
        () => undefined,
      ),
    );
    return settled;
  }

  /**
   * Reserves `declaredBytes` against `ownerId`'s ceiling before any byte of
   * the upload is streamed. Under-declaring cannot beat this: Node delivers
   * no more than a non-chunked request's declared `Content-Length`, and a
   * chunked request that declares nothing reserves the per-file ceiling
   * instead (the caller's responsibility to pass).
   * @param ownerId - Id of the authenticated caller.
   * @param declaredBytes - The request's declared size, reserved for its duration.
   * @returns A `release` function; call it exactly once, whether the upload
   * succeeded or failed, to give the bytes back.
   * @throws InsufficientStorageException if reserving would cross {@link MAX_TOTAL_BYTES_PER_OWNER}.
   */
  async reserve(ownerId: string, declaredBytes: number): Promise<() => void> {
    return this.runExclusive(ownerId, async () => {
      const persisted = await this.persistedTotal(ownerId);
      const inFlight = this.reservedByOwner.get(ownerId) ?? 0;
      const projected = persisted + inFlight + declaredBytes;
      if (projected > MAX_TOTAL_BYTES_PER_OWNER) {
        throw new InsufficientStorageException(
          MAX_TOTAL_BYTES_PER_OWNER - persisted - inFlight,
        );
      }
      this.reservedByOwner.set(ownerId, inFlight + declaredBytes);

      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        const current = this.reservedByOwner.get(ownerId) ?? 0;
        const next = current - declaredBytes;
        if (next <= 0) {
          this.reservedByOwner.delete(ownerId);
        } else {
          this.reservedByOwner.set(ownerId, next);
        }
      };
    });
  }

  /**
   * Sums the stored size of every file — live or soft-deleted-but-not-purged
   * — across all meetings `ownerId` owns.
   * @param ownerId - Id of the account whose committed total is read.
   * @returns The committed byte total, `0` when the owner has no files.
   */
  private async persistedTotal(ownerId: string): Promise<number> {
    const result = await this.prisma.meetingFile.aggregate({
      _sum: { size: true },
      where: { meeting: { ownerId } },
    });
    return result._sum.size ?? 0;
  }
}
