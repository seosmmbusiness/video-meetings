import {
  BadRequestException,
  Controller,
  Get,
  InternalServerErrorException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import contentDisposition from 'content-disposition';
import type { Response } from 'express';
import { basename, dirname } from 'path';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { MeetingFileResponseDto } from './dto/meeting-file-response.dto';
import { FilesService } from './files.service';
import type { UploadedDiskFile } from './files.service';
import { MeetingOwnerGuard } from './guards/meeting-owner.guard';
import { buildMulterOptions } from './multer.config';
import { FileStorage } from './storage/file-storage';

/** Media families served `inline`; every other accepted type downloads. */
const INLINE_MIME_PREFIXES = ['image/', 'video/', 'audio/'];
const INLINE_MIME_EXACT = new Set(['application/pdf']);

/**
 * Whether `mimeType` should be offered inline (played/rendered in the
 * browser) rather than as an `attachment`.
 * @param mimeType - The file's stored, detected MIME type.
 * @returns `true` for image/video/audio and PDF; `false` otherwise.
 */
function isInlineType(mimeType: string): boolean {
  return (
    INLINE_MIME_EXACT.has(mimeType) ||
    INLINE_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))
  );
}

/**
 * Exposes a meeting's files: upload, list and byte serving, all scoped to
 * the meeting's owner via {@link JwtAuthGuard} and {@link MeetingOwnerGuard}.
 */
@ApiTags('files')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, MeetingOwnerGuard)
@Controller('meetings/:meetingId/files')
export class FilesController {
  constructor(
    private readonly filesService: FilesService,
    private readonly fileStorage: FileStorage,
  ) {}

  /**
   * Uploads a file onto a meeting the caller owns.
   * @param meetingId - Id of the meeting, confirmed owned by
   * {@link MeetingOwnerGuard} before this handler runs.
   * @param file - The uploaded file, written to a temp path by multer.
   * @returns The stored file's public DTO.
   * @throws BadRequestException if no `file` part was sent.
   */
  @Post()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', buildMulterOptions()))
  @ApiOperation({ summary: "Upload a file onto the caller's meeting" })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({
    description: 'File stored',
    type: MeetingFileResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiNotFoundResponse({ description: 'Meeting not found' })
  async upload(
    @Param('meetingId') meetingId: string,
    @UploadedFile() file: UploadedDiskFile,
  ): Promise<MeetingFileResponseDto> {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    return this.filesService.create(meetingId, file);
  }

  /**
   * Lists a meeting's live files.
   * @param meetingId - Id of the meeting, confirmed owned by
   * {@link MeetingOwnerGuard} before this handler runs.
   * @param user - The authenticated user, extracted from the JWT.
   * @returns The meeting's live files.
   */
  @Get()
  @ApiOperation({ summary: "List a meeting's files" })
  @ApiOkResponse({
    description: 'The meeting’s live files',
    type: [MeetingFileResponseDto],
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiNotFoundResponse({ description: 'Meeting not found' })
  list(
    @Param('meetingId') meetingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MeetingFileResponseDto[]> {
    return this.filesService.listForOwner(meetingId, user.userId);
  }

  /**
   * Serves a file's bytes to its owner only.
   * @param meetingId - Id of the meeting, confirmed owned by
   * {@link MeetingOwnerGuard} before this handler runs.
   * @param fileId - The file id.
   * @param user - The authenticated user, extracted from the JWT.
   * @param res - The raw response, used to stream the file with `Range`
   * support and to set headers `class-transformer` serialization can't.
   */
  @Get(':fileId/content')
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  @ApiOperation({ summary: "Download a file's bytes" })
  @ApiOkResponse({ description: 'The file bytes' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiNotFoundResponse({ description: 'Meeting or file not found' })
  async content(
    @Param('meetingId') meetingId: string,
    @Param('fileId') fileId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.filesService.findFileForOwner(
      fileId,
      meetingId,
      user.userId,
    );
    res.set('Content-Type', file.mimeType);
    res.set('X-Content-Type-Options', 'nosniff');
    // send@1.2.1 writes `public, max-age=0` whenever Cache-Control is
    // absent, which would label one owner's private bytes cacheable.
    res.set('Cache-Control', 'private, no-store');
    res.set(
      'Content-Disposition',
      contentDisposition(file.name, {
        type: isInlineType(file.mimeType) ? 'inline' : 'attachment',
      }),
    );
    const localPath = this.fileStorage.localPathFor(file.storageKey);
    if (!localPath) {
      // Every bound FileStorage today has a local path; a backend without
      // one needs the streamed-Range fallback D-7 documents, not yet built.
      throw new InternalServerErrorException('File is not readable');
    }
    // send's dotfile check inspects every segment of the path it is given.
    // Passed as one absolute path, that would include STORAGE_ROOT's own
    // `.data` segment and 403 every download; passing `root` + a bare
    // filename limits the check to the storage-key part, which is always a
    // server-generated UUID.
    res.sendFile(basename(localPath), {
      root: dirname(localPath),
      acceptRanges: true,
      dotfiles: 'deny',
    });
  }
}
