import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { basename, dirname } from 'path';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { buildAvatarMulterOptions } from './avatar-multer.config';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AvatarMulterExceptionFilter } from './filters/avatar-multer-exception.filter';
import { AvatarSizeGuard } from './guards/avatar-size.guard';
import { AvatarFilePipe } from './pipes/avatar-file.pipe';
import type { CheckedAvatarUpload } from './pipes/avatar-file.pipe';
import { ProfileService } from './profile.service';

/**
 * Exposes the signed-in caller's own profile and avatar. Every route
 * resolves its subject from `@CurrentUser()` alone — there is no path
 * segment and no body field naming an account, so there is nothing to point
 * at another one (AC-15).
 */
@ApiTags('profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('profile')
export class ProfileController {
  /**
   * @param profileService - Reads and updates the caller's own profile.
   */
  constructor(private readonly profileService: ProfileService) {}

  /**
   * Reads the caller's own profile.
   * @param user - The authenticated user, extracted from the JWT.
   * @returns The caller's profile.
   */
  @Get()
  @ApiOperation({ summary: "Read the authenticated caller's own profile" })
  @ApiOkResponse({ description: 'The profile', type: ProfileResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiNotFoundResponse({ description: 'The account no longer exists' })
  getProfile(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProfileResponseDto> {
    return this.profileService.getProfile(user.userId);
  }

  /**
   * Updates the caller's own profile.
   * @param user - The authenticated user, extracted from the JWT.
   * @param dto - The validated payload; it carries no subject of its own.
   * @returns The caller's profile after the update.
   */
  @Patch()
  @ApiOperation({ summary: "Update the authenticated caller's own profile" })
  @ApiOkResponse({
    description: 'The updated profile',
    type: ProfileResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid profile payload' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiNotFoundResponse({ description: 'The account no longer exists' })
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    return this.profileService.updateProfile(user.userId, dto);
  }

  /**
   * Uploads or replaces the caller's own avatar. Three gates have already
   * run by the time this handler is reached, in D-6's order: the declared
   * size ({@link AvatarSizeGuard}), multer's own `limits.fileSize` — whose
   * abort {@link AvatarMulterExceptionFilter} answers as the same `413` —
   * and content detection ({@link AvatarFilePipe}), which answers `415`
   * while no row exists yet.
   *
   * A first upload answers `201` and a replacement `200`, which is why the
   * response is reached for directly: what happened to the account is not
   * something the returned DTO can say (AC-6).
   * @param user - The authenticated user, extracted from the JWT.
   * @param file - The staged upload, carrying its **detected** type.
   * @param res - The raw response, used only to downgrade `201` to `200`.
   * @returns The caller's profile after the upload.
   */
  @Post('avatar')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(AvatarSizeGuard)
  @UseInterceptors(FileInterceptor('avatar', buildAvatarMulterOptions()))
  @UseFilters(AvatarMulterExceptionFilter)
  @ApiOperation({ summary: "Upload or replace the caller's own avatar" })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['avatar'],
      properties: { avatar: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({
    description: 'The profile, after a first avatar was stored',
    type: ProfileResponseDto,
  })
  @ApiOkResponse({
    description: 'The profile, after an existing avatar was replaced',
    type: ProfileResponseDto,
  })
  @ApiBadRequestResponse({ description: 'The request carried no avatar part' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiNotFoundResponse({ description: 'The account no longer exists' })
  @ApiPayloadTooLargeResponse({
    description: 'The avatar exceeds the 5 MB limit',
  })
  @ApiUnsupportedMediaTypeResponse({
    description: 'The content is not a PNG, JPEG or WebP image',
  })
  async setAvatar(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile(AvatarFilePipe) file: CheckedAvatarUpload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProfileResponseDto> {
    const replacing = (await this.profileService.getProfile(user.userId))
      .hasAvatar;

    const profile = await this.profileService.setAvatar(user.userId, file);
    if (replacing) {
      res.status(HttpStatus.OK);
    }

    return profile;
  }

  /**
   * Serves the caller their own avatar's bytes. The key is resolved from the
   * caller's own row, so there is no id to swap for someone else's image
   * (AC-15) — an account with no avatar gets `404`, whoever asks (AC-9).
   * @param user - The authenticated user, extracted from the JWT.
   * @param res - The raw response, used to set the headers D-8 and T-1 name
   * and to stream the file.
   */
  @Get('avatar')
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  @ApiOperation({ summary: "Download the caller's own avatar bytes" })
  @ApiOkResponse({ description: 'The avatar bytes' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiNotFoundResponse({ description: 'The account holds no avatar' })
  async getAvatar(
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const avatar = await this.profileService.getAvatarFile(user.userId);

    res.set('Content-Type', avatar.mimeType);
    res.set('Content-Disposition', 'inline');
    res.set('X-Content-Type-Options', 'nosniff');
    // send@1.2.1 writes `public, max-age=0` whenever Cache-Control is
    // absent, which would label one owner's private image storable by a
    // shared cache. The 60 seconds is T-1's ruling, not the research's
    // `no-store`: long enough to spare a re-fetch per page, short enough
    // that a removal stops rendering while the browser still holds it.
    res.set('Cache-Control', 'private, max-age=60');

    // send's dotfile check inspects every segment of the path it is given.
    // Passed as one absolute path, that would include STORAGE_ROOT's own
    // `.data` segment and 403 every read; passing `root` + a bare filename
    // limits the check to the key's last segment, a server-generated UUID.
    res.sendFile(basename(avatar.path), {
      root: dirname(avatar.path),
      dotfiles: 'deny',
    });
  }

  /**
   * Removes the caller's own avatar: the columns are cleared first and the
   * bytes deleted after (D-7), and the same profile DTO comes back, so a
   * caller learns the account's state without ever seeing a storage key
   * (S-1, AC-9).
   * @param user - The authenticated user, extracted from the JWT.
   * @returns The caller's profile after the removal.
   */
  @Delete('avatar')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: "Remove the caller's own avatar" })
  @ApiOkResponse({
    description: 'The profile, after the avatar was removed',
    type: ProfileResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiNotFoundResponse({ description: 'The account no longer exists' })
  removeAvatar(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProfileResponseDto> {
    return this.profileService.removeAvatar(user.userId);
  }
}
