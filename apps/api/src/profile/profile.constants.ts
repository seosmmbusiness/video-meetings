/** Longest display name an account may store, matching `User.name`'s `VarChar(80)` (D-2). */
export const MAX_NAME_LENGTH = 80;

/** 400 message when a submitted name is longer than {@link MAX_NAME_LENGTH} (AC-3). */
export const MAX_NAME_LENGTH_MESSAGE = 'Name must be 80 characters or fewer.';
