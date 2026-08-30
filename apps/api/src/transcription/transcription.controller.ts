import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { MeetingOwnerGuard } from '../files/guards/meeting-owner.guard';
import { TranscriptionResponseDto } from './dto/transcription-response.dto';
import { TranscriptionStateListResponseDto } from './dto/transcription-state-list-response.dto';
import {
  TRANSCRIPTION_READ_THROTTLE_LIMIT,
  TRANSCRIPTION_READ_THROTTLE_TTL_MS,
} from './transcription.constants';
import { TranscriptionService } from './transcription.service';

/**
 * Starts a transcription of one stored recording and answers what the run
 * came to — per file, and as a meeting-scoped state list for the page that
 * polls it (D-6).
 *
 * Every route is scoped to the caller's own meeting twice over, as S-1 asks:
 * {@link MeetingOwnerGuard} resolves `:meetingId` before any handler runs —
 * which is the list route's only cover, since it carries no `:fileId` — and
 * the service resolves the file or the meeting again through the files
 * module's public surface.
 */
@ApiTags('transcription')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, MeetingOwnerGuard)
@Controller('meetings/:meetingId')
export class TranscriptionController {
  /** @param transcription - Starts runs and answers what they came to. */
  constructor(private readonly transcription: TranscriptionService) {}

  /**
   * Starts a transcription of one of the caller's recordings. The run works
   * in the background, so this answers `202` with the queued run rather than
   * with a transcript. Nothing in the request body is read — the run's state
   * and its text are the engine's to write, never the caller's.
   *
   * It deliberately carries no `@Throttle` override: the global baseline is
   * what AC-17 is a statement about.
   * @param meetingId - Id of the meeting, already confirmed owned by
   * {@link MeetingOwnerGuard}.
   * @param fileId - Id of the file to transcribe.
   * @param user - The authenticated caller.
   * @returns The queued run.
   */
  @Post('files/:fileId/transcription')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: "Start transcribing one of the caller's recordings",
  })
  @ApiAcceptedResponse({
    description: 'Run queued',
    type: TranscriptionResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiNotFoundResponse({ description: 'File not found' })
  start(
    @Param('meetingId') meetingId: string,
    @Param('fileId') fileId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TranscriptionResponseDto> {
    return this.transcription.startForOwner(fileId, meetingId, user.userId);
  }

  /**
   * Answers one file's run — its state, and its text once it has one.
   * @param meetingId - Id of the meeting the file belongs to.
   * @param fileId - Id of the file.
   * @param user - The authenticated caller.
   * @returns The run, `state` null when nobody has asked for one.
   */
  @Get('files/:fileId/transcription')
  @Throttle({
    default: {
      limit: TRANSCRIPTION_READ_THROTTLE_LIMIT,
      ttl: TRANSCRIPTION_READ_THROTTLE_TTL_MS,
    },
  })
  @ApiOperation({ summary: "Read one recording's transcription" })
  @ApiOkResponse({ type: TranscriptionResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiNotFoundResponse({ description: 'File not found' })
  readOne(
    @Param('meetingId') meetingId: string,
    @Param('fileId') fileId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TranscriptionResponseDto> {
    return this.transcription.getForOwner(fileId, meetingId, user.userId);
  }

  /**
   * Answers the run state of every live file of one meeting, and no
   * transcript text — one request per poll tick (D-6).
   * @param meetingId - Id of the meeting to report on.
   * @param user - The authenticated caller.
   * @returns The meeting's run states.
   */
  @Get('transcriptions')
  @Throttle({
    default: {
      limit: TRANSCRIPTION_READ_THROTTLE_LIMIT,
      ttl: TRANSCRIPTION_READ_THROTTLE_TTL_MS,
    },
  })
  @ApiOperation({ summary: "Read the meeting's transcription states" })
  @ApiOkResponse({ type: TranscriptionStateListResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiNotFoundResponse({ description: 'Meeting not found' })
  async list(
    @Param('meetingId') meetingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TranscriptionStateListResponseDto> {
    return {
      transcriptions: await this.transcription.listForOwner(
        meetingId,
        user.userId,
      ),
    };
  }
}
