import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

/**
 * Reads and updates the signed-in caller's own profile, reaching persistence
 * only through the users module's CQRS surface (D-1, D-3).
 */
@Injectable()
export class ProfileService {
  /**
   * @param queryBus - Used to read the caller's row from the users module.
   * @param commandBus - Used to write the caller's row through the users module.
   */
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
  ) {}

  /**
   * Reads the caller's own profile.
   * @param userId - The caller's id, taken from the verified token.
   * @returns The caller's profile.
   */
  getProfile(userId: string): Promise<ProfileResponseDto> {
    void userId;
    void this.queryBus;
    return Promise.reject(new Error('Not implemented'));
  }

  /**
   * Updates the caller's own profile.
   * @param userId - The caller's id, taken from the verified token.
   * @param dto - The validated, already-normalised payload.
   * @returns The caller's profile after the update.
   */
  updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    void userId;
    void dto;
    void this.commandBus;
    return Promise.reject(new Error('Not implemented'));
  }
}
