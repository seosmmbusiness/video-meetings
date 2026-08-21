/** Longest display name an account may store, matching `User.name`'s `VarChar(80)` (D-2). */
export const MAX_NAME_LENGTH = 80;

/** 400 message when a submitted name is longer than {@link MAX_NAME_LENGTH} (AC-3). */
export const MAX_NAME_LENGTH_MESSAGE = 'Name must be 80 characters or fewer.';

/** Largest avatar the API accepts, in bytes (5 MB, binary) — D-6, AC-7. */
export const MAX_AVATAR_BYTES = 5_242_880;

/**
 * How long the avatar upload route tolerates a request sending no bytes
 * before it is destroyed. An *inactivity* timeout, like the meeting-files
 * one: it resets on every chunk received, so a slow-but-steady transfer runs
 * to completion while a deliberately idle one is cut short (D-6).
 */
export const AVATAR_IDLE_TIMEOUT_MS = 60_000;

/** The three image types an avatar may be, keyed by extension (D-4, D-6). */
export const ACCEPTED_AVATAR_MIME_TYPES: ReadonlyMap<string, string> = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['webp', 'image/webp'],
]);

/** Extensions accepted, in the exact order and wording the 415 message states them. */
export const ACCEPTED_AVATAR_EXTENSIONS_LABEL = 'png, jpg, webp';

/** 413 message body for an avatar over {@link MAX_AVATAR_BYTES} (verbatim, AC-7). */
export const AVATAR_SIZE_LIMIT_MESSAGE = 'Avatar exceeds the 5 MB limit.';

/** 415 message body for content outside {@link ACCEPTED_AVATAR_MIME_TYPES} (verbatim, AC-8). */
export const UNSUPPORTED_AVATAR_TYPE_MESSAGE = `Unsupported image type. Accepted types: ${ACCEPTED_AVATAR_EXTENSIONS_LABEL}.`;

/** 400 message body for an upload carrying no `avatar` part at all. */
export const MISSING_AVATAR_MESSAGE = 'An avatar file is required.';
