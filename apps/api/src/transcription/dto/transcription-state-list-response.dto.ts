import { ApiProperty } from '@nestjs/swagger';
import { TranscriptionStateResponseDto } from './transcription-state-response.dto';

/**
 * Every live file of one meeting with its run state — one request per poll
 * tick, rather than one per file, which is what keeps a full meeting inside
 * the read routes' rate limit (D-6).
 */
export class TranscriptionStateListResponseDto {
  @ApiProperty({
    type: [TranscriptionStateResponseDto],
    description: "The meeting's live files and the state of each one's run",
  })
  transcriptions!: TranscriptionStateResponseDto[];
}
