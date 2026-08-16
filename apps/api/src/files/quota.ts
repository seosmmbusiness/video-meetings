import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Formats a byte count for the 507 message: whole megabytes below 1 GB, two
 * decimal gigabytes at or above it.
 * @param bytes - The byte count to format.
 * @returns A human-readable size, e.g. `"512 MB"` or `"2.50 GB"`.
 */
export function formatBytes(bytes: number): string {
  const oneGb = 1024 ** 3;
  if (bytes >= oneGb) {
    return `${(bytes / oneGb).toFixed(2)} GB`;
  }
  const oneMb = 1024 ** 2;
  return `${Math.max(0, Math.round(bytes / oneMb))} MB`;
}

/**
 * Builds the 507 message naming how much space the owner has left.
 * @param remainingBytes - Bytes left before the owner's 20 GB ceiling
 * (`MAX_TOTAL_BYTES_PER_OWNER`) is reached; never rendered negative.
 * @returns The verbatim message body.
 */
export function insufficientStorageMessage(remainingBytes: number): string {
  return `Not enough space: ${formatBytes(Math.max(0, remainingBytes))} of the 20 GB total remains.`;
}

/**
 * 507 Insufficient Storage — not one of Nest's built-in HTTP exceptions, so
 * modelled directly on {@link HttpException}. Thrown when an upload would
 * take the owner's stored total past the 20 GB ceiling
 * (`MAX_TOTAL_BYTES_PER_OWNER`).
 */
export class InsufficientStorageException extends HttpException {
  /** @param remainingBytes - Bytes left before the ceiling; used to build the message. */
  constructor(remainingBytes: number) {
    super(
      insufficientStorageMessage(remainingBytes),
      HttpStatus.INSUFFICIENT_STORAGE,
    );
  }
}
