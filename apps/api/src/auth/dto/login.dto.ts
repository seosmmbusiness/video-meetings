import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

/**
 * Payload for authenticating with an existing user account.
 */
export class LoginDto {
  @ApiProperty({ example: 'user@example.com', description: 'User email' })
  @IsEmail({}, { message: 'email must be a valid email address' })
  email!: string;

  @ApiProperty({ example: 'Str0ngPass!', description: 'User password' })
  @IsString()
  @IsNotEmpty({ message: 'password must not be empty' })
  password!: string;
}
