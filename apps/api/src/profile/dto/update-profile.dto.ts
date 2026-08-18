import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { MAX_NAME_LENGTH, MAX_NAME_LENGTH_MESSAGE } from '../profile.constants';

// C0 controls and DEL: Postgres cannot store a NUL in a text column, so a
// name carrying one would answer 500 instead of the stated refusal (S-2).
// eslint-disable-next-line no-control-regex -- deliberately stripping C0 control bytes
const CONTROL_CHARACTERS_REGEX = /[\u0000-\u001F\u007F]/g;
// Bidirectional overrides, embeddings and isolates — they make a stored name
// render as something it is not. The plain marks U+200E/U+200F stay: they are
// how a legitimate Hebrew or Arabic name sets its direction.
const BIDI_CONTROL_CHARACTERS_REGEX = /[\u202A-\u202E\u2066-\u2069]/g;

/**
 * class-transformer `@Transform` callback that normalises a display name:
 * control characters and bidirectional overrides are stripped, then the
 * result is trimmed — normalise, never reject, as `FilesService` already does
 * for an uploaded file's name (S-2). Stripping runs before the length check,
 * so removed bytes never count against the limit.
 * @param params - The transform callback params; only `value` is used.
 * @param params.value - The raw field value being transformed.
 * @returns The normalised name, or the original value if it isn't a string.
 */
export function normalizeName({ value }: { value: unknown }): unknown {
  return typeof value === 'string'
    ? value
        .replace(CONTROL_CHARACTERS_REGEX, '')
        .replace(BIDI_CONTROL_CHARACTERS_REGEX, '')
        .trim()
    : value;
}

/**
 * Payload for updating the signed-in caller's own profile. The subject is
 * always the caller's token — this DTO carries no id (AC-15).
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({
    example: 'Ada Lovelace',
    maxLength: MAX_NAME_LENGTH,
    description:
      'Display name; submit an empty string to clear it. Control characters and bidirectional overrides are stripped, and the value is trimmed, before the length is checked.',
  })
  @Transform(normalizeName)
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NAME_LENGTH, { message: MAX_NAME_LENGTH_MESSAGE })
  name?: string;
}
