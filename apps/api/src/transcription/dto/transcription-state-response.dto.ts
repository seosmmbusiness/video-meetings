import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TranscriptionState } from '../../../generated/prisma/client';

/**
 * One file's run state, and nothing else — the shape the meeting's page polls
 * every two seconds. It carries no transcript text on purpose: twenty
 * transcripts of an hour each is roughly a megabyte per tick (D-6).
 */
export class TranscriptionStateResponseDto {
  @ApiProperty({ example: 'b3f1c2a0-....', description: 'Id of the file' })
  fileId!: string;

  @ApiPropertyOptional({
    enum: TranscriptionState,
    nullable: true,
    description: "The run's state, or null when the file has no run",
  })
  state!: TranscriptionState | null;
}
