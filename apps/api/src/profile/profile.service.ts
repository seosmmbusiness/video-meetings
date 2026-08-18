import { Injectable, NotFoundException } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { User } from '../../generated/prisma/client';
import { UpdateUserNameCommand } from '../users/commands/update-user-name.command';
import { FindUserByIdQuery } from '../users/queries/find-user-by-id.query';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

/**
 * Reads and updates the signed-in caller's own profile, reaching persistence
 * only through the users module's CQRS surface (D-1, D-3). Every method takes
 * the subject id from the caller's verified token, so no other account is
 * reachable from here (AC-15).
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
   * @throws NotFoundException if the token names a row that no longer exists.
   */
  async getProfile(userId: string): Promise<ProfileResponseDto> {
    const user = await this.queryBus.execute<FindUserByIdQuery, User | null>(
      new FindUserByIdQuery(userId),
    );
    if (!user) {
      throw new NotFoundException('Profile not found');
    }

    return this.toResponse(user);
  }

  /**
   * Updates the caller's own profile. A payload carrying no `name` at all
   * changes nothing — only an explicitly submitted value is written, and an
   * empty one clears the name (AC-4).
   * @param userId - The caller's id, taken from the verified token.
   * @param dto - The validated, already-normalised payload.
   * @returns The caller's profile after the update.
   * @throws NotFoundException if the token names a row that no longer exists.
   */
  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    if (dto.name === undefined) {
      return this.getProfile(userId);
    }

    const user = await this.commandBus.execute<UpdateUserNameCommand, User>(
      new UpdateUserNameCommand(userId, dto.name),
    );

    return this.toResponse(user);
  }

  /**
   * Maps a Prisma `User` row onto the response, field by field — never a
   * spread and never the entity, so `passwordHash`, `tokenVersion` and the
   * avatar storage key cannot reach the wire (S-1, AC-18).
   * @param user - The caller's own user row.
   * @returns The five fields a profile response carries.
   */
  private toResponse(user: User): ProfileResponseDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      // Derived rather than stored: phase 3 is what starts filling the avatar
      // columns, so both answer "no avatar" for every row today.
      hasAvatar: user.avatarKey !== null,
      avatarUpdatedAt: user.avatarUpdatedAt,
    };
  }
}
