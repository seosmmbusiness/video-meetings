/** Per-file size ceiling in bytes (500 MB, binary): {@link https://www.rfc-editor.org/rfc/rfc9110#status.413 RFC 9110 §15.5.14}. */
export const MAX_FILE_BYTES = 524_288_000;

/** Milliseconds between a file's soft deletion and its permanent purge (30 days). */
export const PURGE_AFTER_MS = 2_592_000_000;

/** Longest a stored file name may be, matching `meeting_files.name`'s `@db.VarChar(255)`. */
export const MAX_FILE_NAME_LENGTH = 255;

/** Most live (not soft-deleted) files a single meeting may hold at once. */
export const MAX_LIVE_FILES_PER_MEETING = 20;

/** Most bytes a single owner may have stored across all meetings (20 GB, binary), counting soft-deleted-but-not-purged files. */
export const MAX_TOTAL_BYTES_PER_OWNER = 21_474_836_480;

/**
 * How long the upload route tolerates a request sending no bytes before it
 * is destroyed (S-9). This is an *inactivity* timeout, distinct from
 * `main.ts`'s `requestTimeout`: it resets on every chunk received, so a
 * slow-but-steady transfer runs to completion while a deliberately idle one
 * is cut short. Ships without a research source line, ratified as written by
 * `pre-issues` T-1.
 */
export const UPLOAD_IDLE_TIMEOUT_MS = 60_000;

/**
 * MIME types this feature accepts, keyed by extension for the 415 message
 * and Swagger docs, and handed to `FileTypeService.detect` as its accepted
 * set (D-4). `text/plain` and `text/markdown` carry no byte signature and
 * are reached through the detector's text-content rule, but they belong in
 * the set all the same: a type absent from it is a type this feature
 * refuses.
 */
export const ACCEPTED_MIME_TYPES: ReadonlyMap<string, string> = new Map([
  ['mp4', 'video/mp4'],
  ['webm', 'video/webm'],
  ['mov', 'video/quicktime'],
  ['mp3', 'audio/mpeg'],
  ['wav', 'audio/wav'],
  ['m4a', 'audio/mp4'],
  ['pdf', 'application/pdf'],
  [
    'docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  ['txt', 'text/plain'],
  ['md', 'text/markdown'],
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
]);

/** Extensions accepted, in the exact order and wording the 415 message states them. */
export const ACCEPTED_EXTENSIONS_LABEL =
  'mp4, webm, mov, mp3, wav, m4a, pdf, docx, txt, md, png, jpg';

/** 413 message body for a file over {@link MAX_FILE_BYTES} (verbatim, from the research Parameters table). */
export const FILE_SIZE_LIMIT_MESSAGE =
  'File exceeds the 500 MB per-file limit.';

/** 415 message body for a file whose detected type isn't accepted (verbatim). */
export const UNSUPPORTED_TYPE_MESSAGE = `Unsupported file type. Accepted types: ${ACCEPTED_EXTENSIONS_LABEL}.`;

/** 409 message body for a meeting already holding {@link MAX_LIVE_FILES_PER_MEETING} live files (verbatim). */
export const LIVE_FILE_CAP_MESSAGE = `This meeting already holds ${MAX_LIVE_FILES_PER_MEETING} files. Delete one to upload another.`;
