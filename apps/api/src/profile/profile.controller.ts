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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ProfileResponseDto } from './dto/profile-response.dto';
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
}
