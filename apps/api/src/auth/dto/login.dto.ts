import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MAX_PASSWORD_LENGTH } from './password-rules';
import { normalizeEmail } from './transforms';

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
