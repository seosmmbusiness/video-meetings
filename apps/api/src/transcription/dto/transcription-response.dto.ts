import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TranscriptionState } from '../../../generated/prisma/client';

/**
 * One file's transcription as the API answers it: the run's state and, once
 * it has one, its text. Built field by field, so the file's storage key and
 * every internal column of the run stay off the wire (task 1.4).
 */
export class TranscriptionResponseDto {
  @ApiProperty({
    example: 'b3f1c2a0-....',
    description: 'Id of the file the run belongs to',
  })
  fileId!: string;

  @ApiPropertyOptional({
    enum: TranscriptionState,
    nullable: true,
    description:
      "The run's state, or null when no transcription has been asked for — a file nobody has transcribed is not a 404, it simply has no run.",
  })
  state!: TranscriptionState | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'The recognised speech, present only once the run SUCCEEDED',
  })
  text!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'en',
    description: 'The language the engine detected in the recording',
  })
  detectedLanguage!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Why the run has no transcript, present only once it FAILED',
  })
  failureReason!: string | null;
}
