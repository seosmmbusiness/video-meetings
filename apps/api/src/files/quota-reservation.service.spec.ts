import type { PrismaService } from '../prisma/prisma.service';
import { MAX_TOTAL_BYTES_PER_OWNER } from './files.constants';
import { QuotaReservationService } from './quota-reservation.service';
import { InsufficientStorageException } from './quota';

/**
 * Builds a stub `PrismaService` whose `meetingFile.aggregate` resolves to a
 * fixed persisted total, regardless of the `where` clause.
 * @param persistedBytes - The sum every aggregate call resolves to.
 * @returns A minimal stand-in for `PrismaService`.
 */
function stubPrisma(persistedBytes: number): PrismaService {
  return {
    meetingFile: {
      aggregate: () => Promise.resolve({ _sum: { size: persistedBytes } }),
    },
  } as unknown as PrismaService;
}

describe('QuotaReservationService', () => {
  it('reserves declared bytes under the ceiling and releases them back', async () => {
    const service = new QuotaReservationService(stubPrisma(0));

    const release = await service.reserve('owner-1', 1_000);
    release();

    // A second reservation for the full ceiling now succeeds, proving the
    // first was actually released rather than left counted forever.
    await expect(
      service.reserve('owner-1', MAX_TOTAL_BYTES_PER_OWNER),
    ).resolves.toBeInstanceOf(Function);
  });

  it('refuses a reservation that would cross the ceiling, naming the remaining space', async () => {
    const service = new QuotaReservationService(
      stubPrisma(MAX_TOTAL_BYTES_PER_OWNER - 1_000),
    );

    await expect(service.reserve('owner-1', 2_000)).rejects.toThrow(
      InsufficientStorageException,
    );
  });

  it('counts a still-unreleased reservation against a second reservation for the same owner (S-3)', async () => {
    const remaining = 5_000_000;
    const service = new QuotaReservationService(
      stubPrisma(MAX_TOTAL_BYTES_PER_OWNER - remaining),
    );

    // First reservation takes most of the remaining space and is not released.
    await service.reserve('owner-1', 4_000_000);

    // Second reservation, still concurrent with the first, sees it as
    // already spent and is refused even though the persisted total alone
    // would have allowed it.
    await expect(service.reserve('owner-1', 4_000_000)).rejects.toThrow(
      InsufficientStorageException,
    );
  });

  it('never lets two concurrent reservations for the same owner both pass a shared ceiling (TOCTOU)', async () => {
    const remaining = 5_000_000;
    const service = new QuotaReservationService(
      stubPrisma(MAX_TOTAL_BYTES_PER_OWNER - remaining),
    );

    const results = await Promise.allSettled([
      service.reserve('owner-1', 4_000_000),
      service.reserve('owner-1', 4_000_000),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it('does not serialize reservations across different owners', async () => {
    const service = new QuotaReservationService(stubPrisma(0));

    const results = await Promise.allSettled([
      service.reserve('owner-1', MAX_TOTAL_BYTES_PER_OWNER),
      service.reserve('owner-2', MAX_TOTAL_BYTES_PER_OWNER),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  });
});
