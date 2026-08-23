import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * Payload for changing the signed-in caller's own password. The subject is
 * always the caller's token — this DTO carries no id (AC-15) — and there is
 * no confirmation field: matching the two typed values is the web form's job
 * (D-11), exactly as `RegisterDto` has no `confirmPassword`.
 *
 * The bounds and the complexity rule the new password has to hold to arrive
 * with task 5.3.
 */
export class ChangePasswordDto {
  @ApiProperty({
    example: 'Str0ngPass!',
    description: "The account's current password, proving the caller owns it",
  })
  @IsString()
  currentPassword!: string;

  @ApiProperty({
    example: 'N3wStrongPass',
    description: 'The password to store in its place',
  })
  @IsString()
  newPassword!: string;
}
