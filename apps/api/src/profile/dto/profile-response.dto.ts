import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Shape of the signed-in caller's own profile as returned by the API.
 *
 * Built field by field from the Prisma `User` row — never spread from it, so
 * `passwordHash`, `tokenVersion` and the avatar storage key cannot reach the
 * wire (S-1, AC-18). The field set is final from phase 1 on: `hasAvatar` and
 * `avatarUpdatedAt` are carried now and filled in phase 3.
 */
export class ProfileResponseDto {
  @ApiProperty({ example: 'b3f1c2a0-....', description: 'Id of the account' })
  id!: string;

  @ApiProperty({ example: 'alice@example.com' })
  email!: string;

  @ApiPropertyOptional({
    example: 'Ada Lovelace',
    nullable: true,
    description: 'Display name, or `null` when the account has none set.',
  })
  name!: string | null;

  @ApiProperty({
    example: false,
    description: 'Whether the account has an avatar stored.',
  })
  hasAvatar!: boolean;

  @ApiPropertyOptional({
    example: '2026-08-18T10:00:00.000Z',
    nullable: true,
    description:
      'When the avatar was last replaced, or `null` if there is none.',
  })
  avatarUpdatedAt!: Date | null;
}
