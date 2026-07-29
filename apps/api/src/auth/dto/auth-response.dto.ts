import { ApiProperty } from '@nestjs/swagger';

/**
 * Response body returned by the register and login endpoints.
 */
export class AuthResponseDto {
  @ApiProperty({ description: 'Signed JWT access token' })
  accessToken!: string;
}
