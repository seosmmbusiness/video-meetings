/**
 * The password rules registration set, shared verbatim with every other route
 * that stores a password so the two can never drift apart (AC-12). The message
 * each rule carries stays with its DTO, because it names the field it refused.
 */

/** At least one lowercase letter, one uppercase letter and one digit. */
export const PASSWORD_COMPLEXITY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;

/** The shortest password the app accepts. */
export const MIN_PASSWORD_LENGTH = 8;

// bcrypt only uses the first 72 bytes of its input; anything past that is a
// wasted (and, for arbitrarily long input, DoS-able) hashing cost.
/** The longest password the app accepts — bcrypt reads no further. */
export const MAX_PASSWORD_LENGTH = 72;
