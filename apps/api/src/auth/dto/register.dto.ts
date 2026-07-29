import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsEmail,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { normalizeEmail } from './transforms';

const PASSWORD_COMPLEXITY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;
// bcrypt only uses the first 72 bytes of its input; anything past that is a
// wasted (and, for arbitrarily long input, DoS-able) hashing cost.
const MAX_PASSWORD_LENGTH = 72;
const MAX_EMAIL_LENGTH = 254;

/**
 * Payload for registering a new user account.
 */
export class RegisterDto {
  @ApiProperty({ example: 'user@example.com', description: 'User email' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(MAX_EMAIL_LENGTH, {
    message: `email must not exceed ${MAX_EMAIL_LENGTH} characters`,
  })
  email!: string;

  @ApiProperty({
    example: 'Str0ngPass!',
    minLength: 8,
    maxLength: MAX_PASSWORD_LENGTH,
    description:
      'At least 8 characters, including an uppercase letter, a lowercase letter, and a digit',
  })
  @MinLength(8, { message: 'password must be at least 8 characters long' })
  @MaxLength(MAX_PASSWORD_LENGTH, {
    message: `password must not exceed ${MAX_PASSWORD_LENGTH} characters`,
  })
  @Matches(PASSWORD_COMPLEXITY_REGEX, {
    message:
      'password must contain an uppercase letter, a lowercase letter, and a digit',
  })
  password!: string;

  @ApiProperty({
    example: true,
    description: 'Must be true — consent to the service terms',
  })
  @Equals(true, { message: 'consentToTerms must be accepted' })
  consentToTerms!: boolean;
}
