/**
 * Largest avatar the API accepts, in bytes (5 MB, binary), matching apps/api's
 * own `MAX_AVATAR_BYTES` — hand-duplicated since there's no shared types
 * package between the two apps. Used to refuse an oversized image in the
 * browser before any transfer starts (AC-7, task 4.3).
 */
export const MAX_AVATAR_BYTES = 5_242_880;

/**
 * The three declared MIME types the browser-side check lets through, matching
 * apps/api's `ACCEPTED_AVATAR_MIME_TYPES` (D-6). It is a convenience filter on
 * what the file *claims* to be, not the boundary: only apps/api reads the
 * bytes themselves, so a renamed file still gets refused upstream (AC-8).
 */
export const ACCEPTED_AVATAR_MIME_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
];

/**
 * The `accept` attribute for the avatar file input, built from
 * {@link ACCEPTED_AVATAR_MIME_TYPES} so the picker hints at the same set the
 * check enforces.
 */
export const AVATAR_ACCEPT_ATTRIBUTE = ACCEPTED_AVATAR_MIME_TYPES.join(',');

/**
 * Client-side refusal message for an image caught over
 * {@link MAX_AVATAR_BYTES} before any transfer starts — verbatim-identical to
 * apps/api's own 413 body (`AVATAR_SIZE_LIMIT_MESSAGE`), so the page reads the
 * same whether the API or the browser caught it (AC-7).
 */
export const AVATAR_SIZE_LIMIT_MESSAGE = 'Avatar exceeds the 5 MB limit.';

/**
 * Client-side refusal message for a declared type outside
 * {@link ACCEPTED_AVATAR_MIME_TYPES} — verbatim-identical to apps/api's own
 * 415 body (`UNSUPPORTED_AVATAR_TYPE_MESSAGE`), for the same reason (AC-8).
 */
export const UNSUPPORTED_AVATAR_TYPE_MESSAGE =
  'Unsupported image type. Accepted types: png, jpg, webp.';

/**
 * Applies the two browser-side checks to a chosen file, in the order the page
 * shows their refusals.
 * @param file - The file the user picked.
 * @returns The refusal to show, or `null` when the file may be sent.
 */
export function refuseAvatar(file: File): string | null {
  if (!ACCEPTED_AVATAR_MIME_TYPES.includes(file.type)) {
    return UNSUPPORTED_AVATAR_TYPE_MESSAGE;
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return AVATAR_SIZE_LIMIT_MESSAGE;
  }
  return null;
}
