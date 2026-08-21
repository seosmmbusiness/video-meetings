import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ProfileResponseDto } from './dto/profile-response.dto';
import type { CheckedAvatarUpload } from './pipes/avatar-file.pipe';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './profile.service';

/**
 * Exposes the signed-in caller's own profile. Both routes resolve their
 * subject from `@CurrentUser()` alone — there is no path segment and no body
 * field naming an account, so there is nothing to point at another one
 * (AC-15).
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

  /* eslint-disable @typescript-eslint/no-unused-vars -- red skeletons; the implementing commit reads every parameter off them */

  /**
   * Replaces the caller's own avatar with the checked upload.
   * @param _user - The authenticated user, extracted from the JWT.
   * @param _file - The staged, content-checked upload.
   * @param _res - The raw response, used to answer 201 or 200.
   * @returns The caller's profile after the upload.
   * @throws Error until the implementation lands.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- red skeleton; the implementing commit wires the route off it
  async setAvatar(
    _user: AuthenticatedUser,
    _file: CheckedAvatarUpload,
    _res: Response,
  ): Promise<ProfileResponseDto> {
    throw new Error('Not implemented');
  }

  /**
   * Serves the caller's own avatar bytes.
   * @param _user - The authenticated user, extracted from the JWT.
   * @param _res - The raw response, used to set the headers D-8 names.
   * @throws Error until the implementation lands.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- red skeleton; the implementing commit wires the route off it
  async getAvatar(_user: AuthenticatedUser, _res: Response): Promise<void> {
    throw new Error('Not implemented');
  }

  /**
   * Removes the caller's own avatar.
   * @param _user - The authenticated user, extracted from the JWT.
   * @returns The caller's profile after the removal.
   * @throws Error until the implementation lands.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- red skeleton; the implementing commit wires the route off it
  async removeAvatar(_user: AuthenticatedUser): Promise<ProfileResponseDto> {
    throw new Error('Not implemented');
  }

  /* eslint-enable @typescript-eslint/no-unused-vars */
}
