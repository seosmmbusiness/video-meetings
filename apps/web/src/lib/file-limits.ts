/**
 * Per-file size ceiling in bytes (500 MB, binary), matching apps/api's own
 * `MAX_FILE_BYTES` — hand-duplicated since there's no shared types package
 * between the two apps. Used to refuse an oversized file in the browser
 * before any transfer starts (AC-5, task 5.5).
 */
export const MAX_FILE_BYTES = 524_288_000;

/**
 * Client-side refusal message for a file caught over {@link MAX_FILE_BYTES}
 * before any transfer starts — verbatim-identical to apps/api's own 413
 * message body (`FILE_SIZE_LIMIT_MESSAGE`), so the row reads the same
 * whether the API or the browser caught it.
 */
export const FILE_SIZE_LIMIT_MESSAGE =
  'File exceeds the 500 MB per-file limit.';
