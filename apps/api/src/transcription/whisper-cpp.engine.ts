import { randomUUID } from 'node:crypto';
import { ClientRequest, request as httpRequest } from 'node:http';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileStorage } from '../storage/file-storage';
import {
  exceedsResponseCeiling,
  parseTranscriptionResult,
  readBoundedBody,
} from './engine-response';
import {
  EngineSettings,
  TranscriptionEngine,
  TranscriptionEngineError,
  TranscriptionResult,
} from './transcription-engine';
import {
  DEFAULT_WHISPER_MODEL,
  DEFAULT_WHISPER_TIMEOUT_MS,
  DEFAULT_WHISPER_URL,
  ENGINE_EFFORT,
  ENGINE_INFERENCE_PATH,
  ENGINE_LANGUAGE_MODE,
  ENGINE_NAME,
  ENGINE_RESPONSE_FORMAT,
  ENGINE_UPLOAD_FILENAME,
} from './transcription.constants';

/** Reason a run ended because the engine could not be reached or did not answer. */
const ENGINE_UNREACHABLE_MESSAGE =
  'The transcription engine could not be reached.';

/** Reason a run ended because the recording's bytes could not be read. */
const RECORDING_UNREADABLE_MESSAGE = 'This recording could not be read.';

/**
 * Reads one positive whole number out of the environment, the way
 * `throttler.config.ts` does: anything unusable keeps the shipped bound
 * rather than widening or disabling it.
 * @param raw - The environment value, as read.
 * @param fallback - The value to keep when `raw` is unusable.
 * @returns The configured number, or the fallback.
 */
function positiveIntOr(raw: string | undefined, fallback: number): number {
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) return fallback;
  return value;
}

/**
 * The only {@link TranscriptionEngine} today: the `whisper.cpp` server running
 * as a compose service, reached over its loopback-only published port (D-1).
 *
 * The recording is carried by `node:http`'s `request()` with a hand-written
 * multipart envelope rather than by `fetch`, because `fetch` retains the whole
 * body — 1152 MB peak RSS against 105 MB for a 1 GiB upload — and this
 * feature's files reach 500 MB (D-2).
 */
@Injectable()
export class WhisperCppEngine extends TranscriptionEngine {
  /**
   * @param config - Reads `WHISPER_URL`, `WHISPER_MODEL` and `WHISPER_TIMEOUT_MS`.
   * @param storage - Opens the recording's bytes by storage key.
   */
  constructor(
    private readonly config: ConfigService,
    private readonly storage: FileStorage,
  ) {
    super();
  }

  /**
   * Reports the settings a run started now would use, `WHISPER_MODEL` being
   * the one string compose and this app both read so they cannot drift (D-3).
   * @returns The engine, model, effort and language mode.
   */
  settings(): EngineSettings {
    return {
      engine: ENGINE_NAME,
      model: this.config.get<string>('WHISPER_MODEL') ?? DEFAULT_WHISPER_MODEL,
      effort: ENGINE_EFFORT,
      languageMode: ENGINE_LANGUAGE_MODE,
    };
  }

  /**
   * Transcribes the recording stored under `storageKey`.
   * @param storageKey - Backend-agnostic storage key of the recording.
   * @param signal - The caller's bound on the run.
   * @returns The recognised text and the language detected in it.
   * @throws {TranscriptionEngineError} For every way the engine can
   * disappoint — unreachable, wedged, non-2xx, oversized or unparseable.
   */
  async transcribe(
    storageKey: string,
    signal: AbortSignal,
  ): Promise<TranscriptionResult> {
    const body = await this.postRecording(storageKey, signal);
    return parseTranscriptionResult(body);
  }

  /**
   * Resolves the engine's `/inference` endpoint from `WHISPER_URL`.
   * @returns The endpoint to post to.
   * @throws {TranscriptionEngineError} When `WHISPER_URL` is unparseable or
   * is not an `http:` endpoint — this client speaks `node:http` and nothing
   * else, so a misconfigured scheme fails the run rather than reaching for a
   * protocol handler it never meant to use.
   */
  private endpoint(): URL {
    const base = (
      this.config.get<string>('WHISPER_URL') ?? DEFAULT_WHISPER_URL
    ).replace(/\/+$/, '');
    let url: URL;
    try {
      url = new URL(`${base}${ENGINE_INFERENCE_PATH}`);
    } catch {
      throw new TranscriptionEngineError(ENGINE_UNREACHABLE_MESSAGE);
    }
    if (url.protocol !== 'http:') {
      throw new TranscriptionEngineError(ENGINE_UNREACHABLE_MESSAGE);
    }
    return url;
  }

  /**
   * Builds the multipart preamble: the two request fields, then the header of
   * the file part the recording's bytes are piped into.
   *
   * Nothing caller-influenced is interpolated into a header — the boundary is
   * a `randomUUID()` and the filename a fixed literal, so the stored file's
   * own name never travels to the engine (D-2).
   * @param boundary - This request's multipart boundary.
   * @returns The bytes preceding the recording.
   */
  private preamble(boundary: string): Buffer {
    const field = (name: string, value: string): string =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
    return Buffer.from(
      field('response_format', ENGINE_RESPONSE_FORMAT) +
        field('language', ENGINE_LANGUAGE_MODE) +
        `--${boundary}\r\nContent-Disposition: form-data; ` +
        `name="file"; filename="${ENGINE_UPLOAD_FILENAME}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
    );
  }

  /**
   * Posts the recording to the engine and reads the answer back, bounded at
   * both ends: `WHISPER_TIMEOUT_MS` on the call, and
   * `MAX_ENGINE_RESPONSE_BYTES` on what comes back.
   * @param storageKey - Backend-agnostic storage key of the recording.
   * @param signal - The caller's bound on the run.
   * @returns The engine's response body.
   * @throws {TranscriptionEngineError} On any transport error, any non-2xx
   * status, an abort, or a response over the byte ceiling — all one failed
   * run, never a failed request.
   */
  private postRecording(
    storageKey: string,
    signal: AbortSignal,
  ): Promise<Buffer> {
    const url = this.endpoint();
    const boundary = `----videoMeetings${randomUUID()}`;
    const timeoutMs = positiveIntOr(
      this.config.get<string>('WHISPER_TIMEOUT_MS'),
      DEFAULT_WHISPER_TIMEOUT_MS,
    );

    return new Promise<Buffer>((resolve, reject) => {
      const request = httpRequest(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
          },
          // The caller's bound and the engine's own, whichever ends first: a
          // wedged engine must not hold the account's single slot for ever.
          signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            // A non-2xx answer and a dead socket are the same outcome here:
            // the run failed, and the body is of no interest either way.
            response.destroy();
            request.destroy();
            reject(
              new TranscriptionEngineError(
                `The transcription engine answered ${status}.`,
              ),
            );
            return;
          }
          if (exceedsResponseCeiling(response.headers['content-length'])) {
            response.destroy();
            request.destroy();
            reject(
              new TranscriptionEngineError(
                'The transcription engine announced more data than a transcript can hold.',
              ),
            );
            return;
          }
          readBoundedBody(response).then(resolve, reject);
        },
      );

      request.on('error', () => {
        reject(new TranscriptionEngineError(ENGINE_UNREACHABLE_MESSAGE));
      });
      this.pipeRecording(storageKey, boundary, request, reject);
    });
  }

  /**
   * Streams the recording into an open request, closing the envelope after it.
   * @param storageKey - Backend-agnostic storage key of the recording.
   * @param boundary - This request's multipart boundary.
   * @param request - The request to write into.
   * @param fail - Ends the run when the recording itself cannot be read.
   */
  private pipeRecording(
    storageKey: string,
    boundary: string,
    request: ClientRequest,
    fail: (error: TranscriptionEngineError) => void,
  ): void {
    request.write(this.preamble(boundary));
    const bytes = this.storage.createReadStream(storageKey);
    bytes.on('error', () => {
      request.destroy();
      fail(new TranscriptionEngineError(RECORDING_UNREADABLE_MESSAGE));
    });
    // `end: false` so the closing boundary can follow the file's last byte;
    // piping is what keeps a 500 MB recording out of the API's heap (D-2).
    bytes.pipe(request, { end: false });
    bytes.on('end', () => request.end(`\r\n--${boundary}--\r\n`));
  }
}
