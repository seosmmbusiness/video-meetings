/**
 * Longest transcript this feature stores, in **characters**, applied to the
 * engine's parsed `text`. Distinct from {@link MAX_ENGINE_RESPONSE_BYTES} and
 * not subsumed by it: a 5 MiB body carrying 1.5 M ASCII characters passes the
 * byte ceiling and is caught only here (research §5).
 */
export const MAX_TRANSCRIPT_CHARS = 1_048_576;

/**
 * Most **bytes** the engine's response may carry, counted while it is read so
 * a repetition loop cannot be buffered before it is rejected (S-3). Sized at
 * 8 MiB against a conservative worst case of ~3.6 MiB, because `verbose_json`
 * emits `segments` unconditionally and carries the text roughly ten times
 * over — a 1 MiB byte ceiling would fail a legitimate non-English hour, which
 * is exactly where AC-13 tests it (research §5).
 */
export const MAX_ENGINE_RESPONSE_BYTES = 8_388_608;

/** Longest detected language accepted, matching `detectedLanguage @db.VarChar(64)`. */
export const MAX_DETECTED_LANGUAGE_LENGTH = 64;

/** Longest failure reason recorded, matching `failureReason @db.VarChar(200)`. */
export const MAX_FAILURE_REASON_LENGTH = 200;

/**
 * Requests a minute either read route accepts, overriding the global
 * baseline: the page polls the meeting-scoped state list every two seconds
 * while a run is in flight, and must never throttle its own owner out (D-6).
 * The **start** route deliberately carries no override — AC-17 is a statement
 * about the baseline itself.
 */
export const TRANSCRIPTION_READ_THROTTLE_LIMIT = 240;

/** Window {@link TRANSCRIPTION_READ_THROTTLE_LIMIT} is counted over, matching `files.controller.ts:196`. */
export const TRANSCRIPTION_READ_THROTTLE_TTL_MS = 60_000;

/**
 * Reason stored when a run ended for a cause the engine never named — the
 * error's own message is never stored, since it can carry a path, a storage
 * key or a line of whatever the recording pointed at (S-8).
 */
export const RUN_FAILED_MESSAGE = 'This recording could not be transcribed.';

/** Engine identity a run records for itself — local, as opposed to a future remote provider (D-3). */
export const ENGINE_NAME = 'local';

/** Decoding effort a run records: greedy, which the compose service spells `-bo 1 -bs -1 -nf` (D-3). */
export const ENGINE_EFFORT = 'low';

/** Language mode a run records: detected, which the compose service spells `-l auto` (D-3). */
export const ENGINE_LANGUAGE_MODE = 'auto';

/** Model used when `WHISPER_MODEL` is unset, the same default `docker-compose.yml` interpolates. */
export const DEFAULT_WHISPER_MODEL = 'tiny';

/** Engine endpoint used when `WHISPER_URL` is unset: the loopback-only port compose publishes. */
export const DEFAULT_WHISPER_URL = 'http://127.0.0.1:9000';

/**
 * Ceiling on a single run's wire call (10 minutes). Measured, not D-3's
 * estimate: a real 55-minute recording transcribed in 160.3 s on this
 * machine (~20.6x realtime, `tiny` model) — a 60-minute recording
 * extrapolates to ~175 s, and this bound gives that over 3x headroom.
 */
export const DEFAULT_WHISPER_TIMEOUT_MS = 600_000;

/** The engine route that transcribes an uploaded recording. */
export const ENGINE_INFERENCE_PATH = '/inference';

/** The only response format carrying both the text and the detected language (`server.cpp:1070`). */
export const ENGINE_RESPONSE_FORMAT = 'verbose_json';

/**
 * The filename the recording is sent under — a fixed literal, never the
 * stored one. The engine only needs *a* name, and interpolating anything
 * caller-influenced into a multipart header is what D-2 forbids.
 */
export const ENGINE_UPLOAD_FILENAME = 'recording';
