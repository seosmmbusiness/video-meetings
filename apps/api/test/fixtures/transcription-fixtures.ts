import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Recordings phase 1's specs transcribe, and the crafted container AC-19
 * needs. The two speech recordings are provisioned on the machine rather
 * than committed (see `README.md` beside this file); the crafted container
 * is built here, byte by byte, so the case that proves AC-19 needs no
 * asset at all.
 */

/** Directory the provisioned recordings are read from. */
const FIXTURE_DIR = __dirname;

/** File name of the English recording AC-4 asserts the words of. */
export const ENGLISH_SPEECH_FIXTURE = 'english-speech.wav';

/** File name of the non-English recording AC-13 asserts the language of. */
export const RUSSIAN_SPEECH_FIXTURE = 'russian-speech.wav';

/**
 * The language `whisper-server` reports for {@link RUSSIAN_SPEECH_FIXTURE}.
 * `whisper_lang_str_full` resolves its id to a full lowercase English name
 * (research §5), so the value stored on the run is `russian`, not `ru`.
 */
export const RUSSIAN_SPEECH_LANGUAGE = 'russian';

/**
 * Reads a provisioned recording's bytes.
 * @param name - Fixture file name, one of the exported constants.
 * @returns The recording's bytes.
 * @throws Error naming the missing file and the README that describes it.
 */
export function readSpeechFixture(name: string): Buffer {
  try {
    return readFileSync(join(FIXTURE_DIR, name));
  } catch {
    throw new Error(
      `Transcription fixture "${name}" is missing. Provision it as apps/api/test/fixtures/README.md describes before running this suite.`,
    );
  }
}

/**
 * Reads the words a recording is known to carry, one per line, from the
 * `<fixture>.words.txt` provisioned beside it. Blank lines are ignored so
 * the file can be kept readable.
 * @param name - Fixture file name whose words are wanted.
 * @returns The expected words, lowercased.
 * @throws Error naming the missing file and the README that describes it.
 */
export function readSpeechFixtureWords(name: string): string[] {
  const wordsFile = `${name}.words.txt`;
  let contents: string;
  try {
    contents = readFileSync(join(FIXTURE_DIR, wordsFile), 'utf8');
  } catch {
    throw new Error(
      `Transcription fixture word list "${wordsFile}" is missing. Provision it as apps/api/test/fixtures/README.md describes before running this suite.`,
    );
  }

  const words = contents
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0);

  if (words.length === 0) {
    throw new Error(`Transcription fixture word list "${wordsFile}" is empty.`);
  }

  return words;
}

/**
 * Wraps a payload in an ISO base-media box: a 32-bit big-endian size, the
 * four-character type, then the payload.
 * @param type - The four-character box type.
 * @param payload - The box's contents.
 * @returns The complete box.
 */
function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + 8, 0);
  header.write(type, 4, 4, 'latin1');
  return Buffer.concat([header, body]);
}

/**
 * The external location AC-19's crafted container points its data
 * reference at. A transcript that ever carried this file's contents would
 * carry the line `root:` with it, which is what the case asserts against.
 */
export const CRAFTED_EXTERNAL_REFERENCE = 'file:///etc/passwd';

/**
 * Builds a QuickTime container whose media data lives *outside* the file: a
 * `dref` entry of type `url ` with its self-contained flag clear and
 * {@link CRAFTED_EXTERNAL_REFERENCE} as its location. It is a real
 * `video/quicktime` by content — the `ftyp` box carries the `qt  ` brand,
 * which is what the upload route's detector matches on — so it reaches the
 * engine the way any accepted recording does, and ffmpeg inside the engine
 * is what meets the external reference (S-8).
 * @returns The crafted container's bytes.
 */
export function craftedExternalReferenceMovBytes(): Buffer {
  const ftyp = box(
    'ftyp',
    Buffer.from('qt  ', 'latin1'),
    Buffer.from([0x20, 0x05, 0x03, 0x00]),
    Buffer.from('qt  ', 'latin1'),
  );

  const location = Buffer.from(`${CRAFTED_EXTERNAL_REFERENCE}\0`, 'latin1');
  const urlEntry = box(
    'url ',
    // version 0, flags 0 — flag bit 1 (self-contained) deliberately clear,
    // which is what makes the location below an external reference.
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    location,
  );
  const dref = box(
    'dref',
    Buffer.from([0x00, 0x00, 0x00, 0x00]), // version and flags
    Buffer.from([0x00, 0x00, 0x00, 0x01]), // one entry
    urlEntry,
  );

  const moov = box(
    'moov',
    box('trak', box('mdia', box('minf', box('dinf', dref)))),
  );

  return Buffer.concat([ftyp, moov]);
}
