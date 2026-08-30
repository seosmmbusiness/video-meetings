import { Readable } from 'node:stream';
import {
  TranscriptionEngineError,
  TranscriptionResult,
} from './transcription-engine';
import {
  MAX_DETECTED_LANGUAGE_LENGTH,
  MAX_ENGINE_RESPONSE_BYTES,
  MAX_TRANSCRIPT_CHARS,
} from './transcription.constants';

/** Reason a response was abandoned for its size, within the reason column. */
const RESPONSE_TOO_LARGE_MESSAGE =
  'The transcription engine answered with more data than a transcript can hold.';

/** Reason a response was refused for its shape, within the reason column. */
const RESPONSE_UNREADABLE_MESSAGE =
  'The transcription engine answered something that is not a transcript.';

/**
 * Decides whether a declared `Content-Length` already puts the response over
 * {@link MAX_ENGINE_RESPONSE_BYTES}, letting the request be destroyed before a
 * body byte is read.
 *
 * A fast path, never the control: `WHISPER_URL` is configuration, so a
 * substituted endpoint can omit the header, garble it or under-report it, and
 * anything unusable therefore means "proceed and let the counter decide"
 * (S-3).
 * @param header - The response's `Content-Length`, as received.
 * @returns `true` only when the header is a whole number over the ceiling.
 */
export function exceedsResponseCeiling(header: string | undefined): boolean {
  if (typeof header !== 'string' || header.trim() === '') return false;
  // Number() rather than parseInt(), which would read '9999999999x' as a size.
  const declared = Number(header);
  if (!Number.isSafeInteger(declared) || declared < 0) return false;
  return declared > MAX_ENGINE_RESPONSE_BYTES;
}

/**
 * Reads an engine response, counting bytes as they arrive and abandoning the
 * stream the moment it passes {@link MAX_ENGINE_RESPONSE_BYTES}.
 *
 * The count is what stops a repetition loop: the body is the one input to this
 * feature with no size contract, and buffering it whole before measuring it is
 * exactly the memory S-3 protects.
 * @param stream - The response body.
 * @returns The body, at most the ceiling in bytes.
 * @throws {TranscriptionEngineError} When the body crosses the ceiling, or the
 * stream fails before it ends.
 */
export function readBoundedBody(stream: Readable): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;

    stream.on('data', (chunk: Buffer) => {
      received += chunk.byteLength;
      if (received > MAX_ENGINE_RESPONSE_BYTES) {
        stream.destroy();
        reject(new TranscriptionEngineError(RESPONSE_TOO_LARGE_MESSAGE));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', () => {
      reject(new TranscriptionEngineError(RESPONSE_UNREADABLE_MESSAGE));
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * Reads a JSON value's own string property, without inheriting one.
 * @param body - The parsed body.
 * @param field - The property to read.
 * @param maxLength - Longest value accepted.
 * @returns The value.
 * @throws {TranscriptionEngineError} When it is absent, not a string, or
 * longer than `maxLength` — rejected rather than truncated, since a value this
 * side of the wire is attacker-influenced through a substituted engine and
 * would otherwise overflow its column mid-run (S-3).
 */
function requireString(
  body: Record<string, unknown>,
  field: string,
  maxLength: number,
): string {
  const value = body[field];
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new TranscriptionEngineError(RESPONSE_UNREADABLE_MESSAGE);
  }
  return value;
}

/**
 * Validates an engine response and keeps the two fields a run stores.
 *
 * Everything else the `verbose_json` envelope carries — `segments`, `words`
 * and their probabilities — is discarded here rather than downstream, so
 * nothing unvalidated reaches the database (S-3).
 * @param body - The response body, already bounded by {@link readBoundedBody}.
 * @returns The transcript and its detected language.
 * @throws {TranscriptionEngineError} When the body is not JSON, is not an
 * object, or carries no usable `text` or `language`.
 */
export function parseTranscriptionResult(body: Buffer): TranscriptionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    throw new TranscriptionEngineError(RESPONSE_UNREADABLE_MESSAGE);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TranscriptionEngineError(RESPONSE_UNREADABLE_MESSAGE);
  }
  const fields = parsed as Record<string, unknown>;
  return {
    text: requireString(fields, 'text', MAX_TRANSCRIPT_CHARS),
    // `language`, not `detected_language`: the field whisper-server actually
    // emits (`server.cpp:1070`).
    detectedLanguage: requireString(
      fields,
      'language',
      MAX_DETECTED_LANGUAGE_LENGTH,
    ),
  };
}
