/*
 * Red-state lint relief: the modules under test land in the commit that greens
 * these cases, so until then every import here resolves to an error type and
 * the typed rules below fire on the whole file. That commit removes this
 * header — the cases underneath it are what stays.
 */
/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import { Readable } from 'node:stream';
import {
  exceedsResponseCeiling,
  parseTranscriptionResult,
  readBoundedBody,
} from './engine-response';
import { TranscriptionEngineError } from './transcription-engine';
import {
  MAX_DETECTED_LANGUAGE_LENGTH,
  MAX_ENGINE_RESPONSE_BYTES,
  MAX_FAILURE_REASON_LENGTH,
  MAX_TRANSCRIPT_CHARS,
} from './transcription.constants';

/**
 * Builds a readable stream that emits `count` chunks of `size` bytes, the
 * shape a repetition-loop response arrives in — many chunks, no single one
 * of them over the ceiling on its own (S-3).
 * @param count - How many chunks to emit.
 * @param size - Bytes per chunk.
 * @returns A stream of `count * size` bytes.
 */
function chunkedStream(count: number, size: number): Readable {
  const chunk = Buffer.alloc(size, 0x61);
  let sent = 0;
  return new Readable({
    read() {
      this.push(sent++ < count ? chunk : null);
    },
  });
}

/**
 * Serialises a `verbose_json`-shaped body, including the `segments` array the
 * engine emits unconditionally, so the parser is proven to discard it.
 * @param body - The fields to serialise.
 * @returns The JSON body as a buffer.
 */
function verboseJson(body: Record<string, unknown>): Buffer {
  return Buffer.from(
    JSON.stringify({
      segments: [{ text: 'a segment', probability: 0.9 }],
      ...body,
    }),
  );
}

describe('exceedsResponseCeiling', () => {
  it('refuses a declared length over the ceiling', () => {
    expect(exceedsResponseCeiling(String(MAX_ENGINE_RESPONSE_BYTES + 1))).toBe(
      true,
    );
  });

  it('accepts a declared length at the ceiling', () => {
    expect(exceedsResponseCeiling(String(MAX_ENGINE_RESPONSE_BYTES))).toBe(
      false,
    );
  });

  it.each([
    ['absent', undefined],
    ['blank', ''],
    ['unparseable', 'lots'],
    ['negative', '-1'],
    ['fractional', '1.5'],
    ['under-reported', '10'],
  ])(
    'lets the counter decide when the length is %s',
    (_case, header: string | undefined) => {
      // WHISPER_URL is configuration: a substituted endpoint can omit the
      // header or lie about it, so it is a fast path and never the control.
      expect(exceedsResponseCeiling(header)).toBe(false);
    },
  );
});

describe('readBoundedBody', () => {
  it('returns a body under the ceiling', async () => {
    await expect(readBoundedBody(Readable.from(['{"ok":1}']))).resolves.toEqual(
      Buffer.from('{"ok":1}'),
    );
  });

  it('returns a body of exactly the ceiling', async () => {
    const body = await readBoundedBody(
      chunkedStream(8, MAX_ENGINE_RESPONSE_BYTES / 8),
    );
    expect(body.byteLength).toBe(MAX_ENGINE_RESPONSE_BYTES);
  });

  it('abandons a body over the ceiling that arrives in many chunks', async () => {
    const stream = chunkedStream(9, 1_048_576);
    await expect(readBoundedBody(stream)).rejects.toBeInstanceOf(
      TranscriptionEngineError,
    );
    expect(stream.destroyed).toBe(true);
  });

  it('states a readable reason within the failure-reason column', async () => {
    const error = await readBoundedBody(chunkedStream(9, 1_048_576)).catch(
      (caught: TranscriptionEngineError) => caught,
    );
    expect(error).toBeInstanceOf(TranscriptionEngineError);
    expect((error as TranscriptionEngineError).message).toMatch(/engine/i);
    expect(
      (error as TranscriptionEngineError).message.length,
    ).toBeLessThanOrEqual(MAX_FAILURE_REASON_LENGTH);
  });

  it('fails the run when the stream errors mid-body', async () => {
    const stream = new Readable({
      read() {
        this.destroy(new Error('ECONNRESET'));
      },
    });
    await expect(readBoundedBody(stream)).rejects.toBeInstanceOf(
      TranscriptionEngineError,
    );
  });
});

describe('parseTranscriptionResult', () => {
  it('keeps the text and the detected language and discards everything else', () => {
    const result = parseTranscriptionResult(
      verboseJson({ text: ' the words spoken ', language: 'english' }),
    );
    expect(result).toEqual({
      text: ' the words spoken ',
      detectedLanguage: 'english',
    });
  });

  it('reads `language`, not `detected_language`', () => {
    // server.cpp:1070 emits `language`; a parser reading the OpenAI spelling
    // would silently take a substituted engine's word for it.
    expect(() =>
      parseTranscriptionResult(
        verboseJson({ text: 'hello', detected_language: 'english' }),
      ),
    ).toThrow(TranscriptionEngineError);
  });

  it.each([
    ['not JSON at all', Buffer.from('<html>502</html>')],
    ['a JSON array', Buffer.from('[]')],
    ['JSON null', Buffer.from('null')],
    ['a JSON string', Buffer.from('"text"')],
  ])('fails cleanly on %s', (_case, body: Buffer) => {
    expect(() => parseTranscriptionResult(body)).toThrow(
      TranscriptionEngineError,
    );
  });

  it.each([
    ['missing', {}],
    ['null', { text: null }],
    ['a number', { text: 42 }],
    ['an object', { text: { toString: 'no' } }],
  ])('fails when `text` is %s', (_case, body: Record<string, unknown>) => {
    expect(() =>
      parseTranscriptionResult(verboseJson({ language: 'english', ...body })),
    ).toThrow(TranscriptionEngineError);
  });

  it('accepts text of exactly MAX_TRANSCRIPT_CHARS characters', () => {
    const text = 'a'.repeat(MAX_TRANSCRIPT_CHARS);
    expect(
      parseTranscriptionResult(verboseJson({ text, language: 'english' })).text,
    ).toHaveLength(MAX_TRANSCRIPT_CHARS);
  });

  it('fails when text is over MAX_TRANSCRIPT_CHARS characters', () => {
    // Under the byte ceiling and over the character one: the two bite in
    // disjoint places, which is why both are kept (research §5).
    const body = verboseJson({
      text: 'a'.repeat(MAX_TRANSCRIPT_CHARS + 1),
      language: 'english',
    });
    expect(body.byteLength).toBeLessThan(MAX_ENGINE_RESPONSE_BYTES);
    expect(() => parseTranscriptionResult(body)).toThrow(
      TranscriptionEngineError,
    );
  });

  it.each([
    ['missing', {}],
    ['null', { language: null }],
    ['a number', { language: 7 }],
  ])('fails when `language` is %s', (_case, body: Record<string, unknown>) => {
    expect(() =>
      parseTranscriptionResult(verboseJson({ text: 'hello', ...body })),
    ).toThrow(TranscriptionEngineError);
  });

  it('accepts a language of exactly MAX_DETECTED_LANGUAGE_LENGTH characters', () => {
    const language = 'r'.repeat(MAX_DETECTED_LANGUAGE_LENGTH);
    expect(
      parseTranscriptionResult(verboseJson({ text: 'hello', language }))
        .detectedLanguage,
    ).toBe(language);
  });

  it('rejects an over-long language rather than truncating it', () => {
    // It would overflow `detectedLanguage @db.VarChar(64)` mid-run, leaving
    // the row stuck RUNNING until the boot sweep (S-3).
    expect(() =>
      parseTranscriptionResult(
        verboseJson({
          text: 'hello',
          language: 'r'.repeat(MAX_DETECTED_LANGUAGE_LENGTH + 1),
        }),
      ),
    ).toThrow(TranscriptionEngineError);
  });
});
