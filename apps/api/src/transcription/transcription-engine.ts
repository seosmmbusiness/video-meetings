/** What one finished transcription answers with, and nothing else. */
export interface TranscriptionResult {
  /** The recognised speech, within `MAX_TRANSCRIPT_CHARS` characters. */
  text: string;
  /** The language the engine detected, within `MAX_DETECTED_LANGUAGE_LENGTH`. */
  detectedLanguage: string;
}

/** The settings a run records for itself, so a stored row explains its own text (D-3). */
export interface EngineSettings {
  /** Which engine ran it, e.g. `local`. */
  engine: string;
  /** Which model it ran, e.g. `tiny`. */
  model: string;
  /** How hard it decoded, e.g. `low`. */
  effort: string;
  /** How the language was chosen, e.g. `auto`. */
  languageMode: string;
}

/**
 * A run that ended without a transcript, carrying a reason short enough for
 * `failureReason @db.VarChar(200)` and free of anything the owner supplied.
 *
 * Every way the engine can disappoint — absent, unreachable, wedged, killed
 * under its memory limit, answering a non-2xx status, an oversized body or a
 * shape that is not a transcript — arrives as this one class, because the root
 * `CLAUDE.md`'s rule for optional infrastructure applies here too: a failed
 * run, never a failed startup and never a failed request.
 */
export class TranscriptionEngineError extends Error {
  /**
   * @param message - The reason, stated for the owner rather than the log.
   */
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptionEngineError';
  }
}

/**
 * Backend-agnostic boundary for turning stored bytes into text: everything in
 * `apps/api` that needs a recording transcribed goes through this class,
 * keyed by the same storage key {@link FileStorage} uses rather than a path or
 * a URL. Bound as its own Nest injection token exactly as `FileStorage` is,
 * with `WhisperCppEngine` the only implementation today (D-1) — which is what
 * lets a unit spec override the token, so `pre-push` never needs an engine
 * running, and lets a future remote provider be a second implementation and
 * nothing else.
 */
export abstract class TranscriptionEngine {
  /**
   * Transcribes the recording stored under `storageKey`.
   * @param storageKey - Backend-agnostic storage key of the recording.
   * @param signal - Bounds the run; aborting it ends the call.
   * @returns The recognised text and the language detected in it.
   * @throws {TranscriptionEngineError} When the run cannot produce a
   * transcript this feature is willing to store, for any reason.
   */
  abstract transcribe(
    storageKey: string,
    signal: AbortSignal,
  ): Promise<TranscriptionResult>;

  /**
   * Reports the settings a run started now would use.
   * @returns The engine, model, effort and language mode.
   */
  abstract settings(): EngineSettings;
}
