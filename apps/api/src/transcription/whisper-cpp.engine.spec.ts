/*
 * Red-state lint relief: the modules under test land in the commit that greens
 * these cases, so until then every import here resolves to an error type and
 * the typed rules below fire on the whole file. That commit removes this
 * header — the cases underneath it are what stays.
 */
/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import {
  IncomingMessage,
  Server,
  ServerResponse,
  createServer,
} from 'node:http';
import { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import type { ConfigService } from '@nestjs/config';
import { FileStorage } from '../storage/file-storage';
import { TranscriptionEngineError } from './transcription-engine';
import {
  ENGINE_EFFORT,
  ENGINE_LANGUAGE_MODE,
  ENGINE_NAME,
  ENGINE_UPLOAD_FILENAME,
  MAX_ENGINE_RESPONSE_BYTES,
} from './transcription.constants';
import { WhisperCppEngine } from './whisper-cpp.engine';

/** The storage key under test — never a name, and never on the wire either. */
const STORAGE_KEY = 'meetings/4f6a/9c21-board-standup';

/** The recording's bytes, small enough to assert on in full. */
const RECORDING = Buffer.from('RIFF....WAVEfmt the recording bytes');

/** What the stub engine recorded about the request it last answered. */
interface RecordedRequest {
  method: string | undefined;
  url: string | undefined;
  contentType: string | undefined;
  body: Buffer;
}

/**
 * Builds a stub `ConfigService` over a plain map, matching how the real one
 * answers `undefined` for a variable that is not set.
 * @param values - The environment values to resolve.
 * @returns A minimal stand-in for `ConfigService`.
 */
function stubConfig(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

/**
 * Builds a stub `FileStorage` that streams `bytes` for any key.
 * @param bytes - The recording's bytes to stream.
 * @returns A minimal stand-in for `FileStorage`.
 */
function stubStorage(bytes: Buffer = RECORDING): FileStorage {
  return {
    createReadStream: () => Readable.from([bytes]),
  } as unknown as FileStorage;
}

describe('WhisperCppEngine', () => {
  let server: Server;
  let url: string;
  let recorded: RecordedRequest | undefined;
  let answer: (req: IncomingMessage, res: ServerResponse) => void;

  beforeEach(async () => {
    recorded = undefined;
    answer = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ text: 'the words spoken', language: 'english' }),
      );
    };
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        recorded = {
          method: req.method,
          url: req.url,
          contentType: req.headers['content-type'],
          body: Buffer.concat(chunks),
        };
      });
      // A destroyed client socket must not take the stub server with it.
      res.on('error', () => {});
      answer(req, res);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  });

  /**
   * Builds the engine under test against the stub server.
   * @param values - Extra environment values, over `WHISPER_URL`.
   * @param storage - The storage the recording is streamed from.
   * @returns The engine.
   */
  function engine(
    values: Record<string, string> = {},
    storage: FileStorage = stubStorage(),
  ): WhisperCppEngine {
    return new WhisperCppEngine(
      stubConfig({ WHISPER_URL: url, ...values }),
      storage,
    );
  }

  describe('settings', () => {
    it('reports the engine, model, effort and language mode a run records', () => {
      expect(engine({ WHISPER_MODEL: 'base' }).settings()).toEqual({
        engine: ENGINE_NAME,
        model: 'base',
        effort: ENGINE_EFFORT,
        languageMode: ENGINE_LANGUAGE_MODE,
      });
    });

    it('falls back to the tiny model when WHISPER_MODEL is unset', () => {
      expect(engine().settings().model).toBe('tiny');
    });
  });

  describe('the wire call', () => {
    it('posts the recording to /inference as multipart/form-data', async () => {
      await engine().transcribe(STORAGE_KEY, new AbortController().signal);

      expect(recorded?.method).toBe('POST');
      expect(recorded?.url).toBe('/inference');
      expect(recorded?.contentType).toMatch(
        /^multipart\/form-data; boundary=.+/,
      );
    });

    it('sends response_format=verbose_json and language=auto', async () => {
      await engine().transcribe(STORAGE_KEY, new AbortController().signal);
      const body = recorded!.body.toString('latin1');

      expect(body).toContain('name="response_format"');
      expect(body).toContain('verbose_json');
      expect(body).toContain('name="language"');
      expect(body).toContain('auto');
    });

    it('sends the file part under a fixed filename, and the bytes unchanged', async () => {
      await engine().transcribe(STORAGE_KEY, new AbortController().signal);
      const body = recorded!.body.toString('latin1');

      expect(body).toContain(
        `name="file"; filename="${ENGINE_UPLOAD_FILENAME}"`,
      );
      expect(recorded!.body.includes(RECORDING)).toBe(true);
    });

    it('never lets the stored key travel with the recording', async () => {
      await engine().transcribe(STORAGE_KEY, new AbortController().signal);

      expect(recorded!.body.toString('latin1')).not.toContain(STORAGE_KEY);
    });

    it('closes the envelope with its own boundary', async () => {
      await engine().transcribe(STORAGE_KEY, new AbortController().signal);
      const boundary = /boundary=(.+)$/.exec(recorded!.contentType!)![1];

      expect(recorded!.body.toString('latin1')).toContain(`--${boundary}--`);
    });

    it('uses a fresh boundary for every call', async () => {
      const subject = engine();
      await subject.transcribe(STORAGE_KEY, new AbortController().signal);
      const first = recorded!.contentType;
      await subject.transcribe(STORAGE_KEY, new AbortController().signal);

      expect(recorded!.contentType).not.toBe(first);
    });

    it('answers the transcript and the detected language', async () => {
      await expect(
        engine().transcribe(STORAGE_KEY, new AbortController().signal),
      ).resolves.toEqual({
        text: 'the words spoken',
        detectedLanguage: 'english',
      });
    });
  });

  describe('degrading to a failed run', () => {
    it('fails when the engine answers a non-2xx status', async () => {
      answer = (_req, res) => {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('out of memory');
      };

      await expect(
        engine().transcribe(STORAGE_KEY, new AbortController().signal),
      ).rejects.toBeInstanceOf(TranscriptionEngineError);
    });

    it('fails the same way when the engine dies mid-answer', async () => {
      // The engine dying under 1.6's memory limit is a transport error, and
      // it is treated exactly as a non-2xx answer is.
      answer = (_req, res) => {
        res.socket?.destroy();
      };

      await expect(
        engine().transcribe(STORAGE_KEY, new AbortController().signal),
      ).rejects.toBeInstanceOf(TranscriptionEngineError);
    });

    it('fails, rather than throwing at startup, when the engine is absent', async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));

      await expect(
        engine().transcribe(STORAGE_KEY, new AbortController().signal),
      ).rejects.toBeInstanceOf(TranscriptionEngineError);
    });

    it('fails when the engine answers a body that is not JSON', async () => {
      answer = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html>hello</html>');
      };

      await expect(
        engine().transcribe(STORAGE_KEY, new AbortController().signal),
      ).rejects.toBeInstanceOf(TranscriptionEngineError);
    });

    it('abandons a response over the byte ceiling that declares no length', async () => {
      // No Content-Length to consult: the counter is what stops it (S-3).
      answer = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const megabyte = Buffer.alloc(1_048_576, 0x61);
        for (let written = 0; written < 9; written += 1) res.write(megabyte);
        res.end();
      };

      await expect(
        engine().transcribe(STORAGE_KEY, new AbortController().signal),
      ).rejects.toBeInstanceOf(TranscriptionEngineError);
    });

    it('refuses a response whose declared length is over the ceiling', async () => {
      answer = (_req, res) => {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': String(MAX_ENGINE_RESPONSE_BYTES + 1),
        });
        res.write('{"text":"');
      };

      await expect(
        engine().transcribe(STORAGE_KEY, new AbortController().signal),
      ).rejects.toBeInstanceOf(TranscriptionEngineError);
    });

    it('fails when the caller aborts the run', async () => {
      answer = () => {};
      const controller = new AbortController();
      const run = engine().transcribe(STORAGE_KEY, controller.signal);
      controller.abort();

      await expect(run).rejects.toBeInstanceOf(TranscriptionEngineError);
    });

    it('fails when a wedged engine outlasts WHISPER_TIMEOUT_MS', async () => {
      answer = () => {};

      await expect(
        engine({ WHISPER_TIMEOUT_MS: '50' }).transcribe(
          STORAGE_KEY,
          new AbortController().signal,
        ),
      ).rejects.toBeInstanceOf(TranscriptionEngineError);
    });

    it('fails when WHISPER_URL is not an http endpoint', async () => {
      await expect(
        engine({ WHISPER_URL: 'file:///etc/passwd' }).transcribe(
          STORAGE_KEY,
          new AbortController().signal,
        ),
      ).rejects.toBeInstanceOf(TranscriptionEngineError);
    });
  });
});
