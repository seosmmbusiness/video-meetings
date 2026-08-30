import { TranscriptionState } from '../../generated/prisma/client';
import { TranscriptionResponseDto } from './dto/transcription-response.dto';
import { TranscriptionEngineError } from './transcription-engine';
import {
  MAX_FAILURE_REASON_LENGTH,
  RUN_FAILED_MESSAGE,
} from './transcription.constants';

/** The columns a read of one run needs, and no more. */
export const RUN_VIEW_COLUMNS = {
  state: true,
  text: true,
  detectedLanguage: true,
  failureReason: true,
} as const;

/** One run as the read routes see it, before it becomes a response. */
export interface RunView {
  state: TranscriptionState;
  text: string | null;
  detectedLanguage: string | null;
  failureReason: string | null;
}

/**
 * Builds the per-file response field by field, so nothing the row carries
 * internally — its id, its engine settings, its timestamps, and the file's
 * storage key — can reach the wire by accident.
 * @param fileId - Id of the file the run belongs to.
 * @param run - The run's row, or null when the file has none.
 * @returns The response body for one file's transcription.
 */
export function toTranscriptionResponse(
  fileId: string,
  run: RunView | null,
): TranscriptionResponseDto {
  return {
    fileId,
    state: run?.state ?? null,
    text: run?.text ?? null,
    detectedLanguage: run?.detectedLanguage ?? null,
    failureReason: run?.failureReason ?? null,
  };
}

/**
 * Turns whatever ended a run into a reason short enough for
 * `failureReason @db.VarChar(200)`. Only the engine's own messages are
 * repeated back — they are fixed literals; anything else becomes one generic
 * sentence, because an arbitrary error can name a path, a storage key or a
 * line of whatever a crafted container pointed at (S-8).
 * @param error - Whatever the run threw.
 * @returns The reason to store.
 */
export function failureReasonOf(error: unknown): string {
  const reason =
    error instanceof TranscriptionEngineError
      ? error.message
      : RUN_FAILED_MESSAGE;
  return reason.slice(0, MAX_FAILURE_REASON_LENGTH);
}
