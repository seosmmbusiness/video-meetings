import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsEmail, Matches, MinLength } from 'class-validator';

const PASSWORD_COMPLEXITY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;

/**
 * Payload for registering a new user account.
 */
export class RegisterDto {
  @ApiProperty({ example: 'user@example.com', description: 'User email' })
  @IsEmail({}, { message: 'email must be a valid email address' })
  email!: string;

  @ApiProperty({
    example: 'Str0ngPass!',
    minLength: 8,
    description:
      'At least 8 characters, including an uppercase letter, a lowercase letter, and a digit',
  })
  @MinLength(8, { message: 'password must be at least 8 characters long' })
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
