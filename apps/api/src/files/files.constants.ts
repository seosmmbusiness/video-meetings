/** Per-file size ceiling in bytes (500 MB, binary): {@link https://www.rfc-editor.org/rfc/rfc9110#status.413 RFC 9110 §15.5.14}. */
export const MAX_FILE_BYTES = 524_288_000;

/** Milliseconds between a file's soft deletion and its permanent purge (30 days). */
export const PURGE_AFTER_MS = 2_592_000_000;

/** Longest a stored file name may be, matching `meeting_files.name`'s `@db.VarChar(255)`. */
export const MAX_FILE_NAME_LENGTH = 255;
