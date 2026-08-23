import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_COMPLEXITY_REGEX,
} from '../../auth/dto/password-rules';

/**
 * Payload for changing the signed-in caller's own password. The subject is
 * always the caller's token — this DTO carries no id (AC-15) — and there is
 * no confirmation field: matching the two typed values is the web form's job
 * (D-11), exactly as `RegisterDto` has no `confirmPassword`.
 *
 * `newPassword` holds the same rules registration does, from the same
 * constants, and each refusal names the rule it broke (AC-12).
 * `currentPassword` is bounded like `LoginDto`'s — it is only ever compared
 * against a stored hash, so a complexity rule on it would refuse accounts
 * whose password predates the rule.
 */
export class ChangePasswordDto {
  @ApiProperty({
    example: 'Str0ngPass!',
    maxLength: MAX_PASSWORD_LENGTH,
    description: "The account's current password, proving the caller owns it",
  })
  @IsString()
  @IsNotEmpty({ message: 'currentPassword must not be empty' })
  @MaxLength(MAX_PASSWORD_LENGTH, {
    message: `currentPassword must not exceed ${MAX_PASSWORD_LENGTH} characters`,
  })
  currentPassword!: string;

  @ApiProperty({
    example: 'N3wStrongPass',
    minLength: MIN_PASSWORD_LENGTH,
    maxLength: MAX_PASSWORD_LENGTH,
    description:
      'At least 8 characters, including an uppercase letter, a lowercase letter, and a digit',
  })
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `newPassword must be at least ${MIN_PASSWORD_LENGTH} characters long`,
  })
  @MaxLength(MAX_PASSWORD_LENGTH, {
    message: `newPassword must not exceed ${MAX_PASSWORD_LENGTH} characters`,
  })
  @Matches(PASSWORD_COMPLEXITY_REGEX, {
    message:
      'newPassword must contain an uppercase letter, a lowercase letter, and a digit',
  })
  newPassword!: string;
}
