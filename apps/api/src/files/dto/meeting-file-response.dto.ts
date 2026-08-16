import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Shape of a meeting file as returned by the API. Never carries the
 * backend-agnostic storage key or a filesystem path.
 */
export class MeetingFileResponseDto {
  @ApiProperty({ example: 'b3f1c2a0-....' })
  id!: string;

  @ApiProperty({ example: 'b3f1c2a0-....', description: 'Id of the meeting' })
  meetingId!: string;

  @ApiProperty({ example: 'sprint-planning-recording.mp4' })
  name!: string;

  @ApiProperty({ example: 524_288, description: 'Size in bytes' })
  size!: number;

  @ApiProperty({ example: 'video/mp4' })
  mimeType!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiPropertyOptional({ nullable: true, description: 'Set once soft-deleted' })
  deletedAt!: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Absolute purge time once soft-deleted; an ISO timestamp rather than a countdown so a cached response cannot drift.',
  })
  purgeAt!: Date | null;
}
