import { Controller } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './profile.service';

/**
 * Exposes the signed-in caller's own profile. Every route resolves its
 * subject from the verified token alone (AC-15).
 */
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
  getProfile(user: AuthenticatedUser): Promise<ProfileResponseDto> {
    void user;
    void this.profileService;
    return Promise.reject(new Error('Not implemented'));
  }

  /**
   * Updates the caller's own profile.
   * @param user - The authenticated user, extracted from the JWT.
   * @param dto - The validated payload; it carries no subject of its own.
   * @returns The caller's profile after the update.
   */
  updateProfile(
    user: AuthenticatedUser,
    dto: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    void user;
    void dto;
    return Promise.reject(new Error('Not implemented'));
  }
}
