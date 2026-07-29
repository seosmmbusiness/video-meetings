import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { normalizeEmail } from './transforms';

// bcrypt only uses the first 72 bytes of its input; anything past that is a
// wasted (and, for arbitrarily long input, DoS-able) hashing cost.
const MAX_PASSWORD_LENGTH = 72;
const MAX_EMAIL_LENGTH = 254;

/**
 * Payload for authenticating with an existing user account.
 */
export class LoginDto {
  @ApiProperty({ example: 'user@example.com', description: 'User email' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(MAX_EMAIL_LENGTH, {
    message: `email must not exceed ${MAX_EMAIL_LENGTH} characters`,
  })
  email!: string;

  @ApiProperty({ example: 'Str0ngPass!', description: 'User password' })
  @IsString()
  @IsNotEmpty({ message: 'password must not be empty' })
  @MaxLength(MAX_PASSWORD_LENGTH, {
    message: `password must not exceed ${MAX_PASSWORD_LENGTH} characters`,
  })
  password!: string;
}
