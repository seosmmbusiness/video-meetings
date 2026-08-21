import { randomUUID } from 'crypto';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { User } from '../../generated/prisma/client';
import { FileStorage } from '../storage/file-storage';
import { UpdateUserAvatarCommand } from '../users/commands/update-user-avatar.command';
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
  private readonly logger = new Logger(ProfileService.name);

  /**
   * @param queryBus - Used to read the caller's row from the users module.
   * @param commandBus - Used to write the caller's row through the users module.
   * @param storage - The byte boundary the avatar is committed to and deleted
   * from, reached through `StorageModule` rather than the files feature (D-4).
   */
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
    private readonly storage: FileStorage,
  ) {}

  /**
   * Reads the caller's own profile.
   * @param userId - The caller's id, taken from the verified token.
   * @returns The caller's profile.
   * @throws NotFoundException if the token names a row that no longer exists.
   */
  async getProfile(userId: string): Promise<ProfileResponseDto> {
    return this.toResponse(await this.findUser(userId));
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
   * Replaces the caller's own avatar with an upload the route has already
   * staged and content-checked: the bytes are committed under a fresh key,
   * the four avatar columns are written as one group, and only then are the
   * previous key's bytes deleted (D-5, D-7).
   *
   * The key carries a fresh `randomUUID()` per upload, which is what makes a
   * replacement atomic from the reader's side: the row points at either the
   * old key or the new one, never at a half-written file (AC-6).
   * @param userId - The caller's id, taken from the verified token.
   * @param file - The staged upload: its temp path, detected type and size.
   * @returns The caller's profile after the replacement.
   * @throws NotFoundException if the token names a row that no longer exists.
   */
  async setAvatar(
    userId: string,
    file: { path: string; mimetype: string; size: number },
  ): Promise<ProfileResponseDto> {
    const previousKey = (await this.findUser(userId)).avatarKey;
    const key = `users/${userId}/avatar/${randomUUID()}`;

    await this.storage.save(key, file.path);

    let updated: User;
    try {
      updated = await this.commandBus.execute<UpdateUserAvatarCommand, User>(
        new UpdateUserAvatarCommand(userId, {
          key,
          mimeType: file.mimetype,
          size: file.size,
        }),
      );
    } catch (error) {
      // Nothing references these bytes — the row still points at the previous
      // key, or at nothing — so drop them rather than leave an orphan (S-5).
      await this.deleteBytes(key);
      throw error;
    }

    if (previousKey !== null) {
      await this.deleteBytes(previousKey);
    }

    return this.toResponse(updated);
  }

  /**
   * Removes the caller's own avatar: the four columns are cleared first and
   * the bytes deleted after, so an interrupted removal leaves unreachable
   * bytes rather than a row pointing at nothing (D-7).
   *
   * An account with no avatar is left exactly as it is, so a repeated removal
   * answers the same profile rather than writing four columns that are
   * already null.
   * @param userId - The caller's id, taken from the verified token.
   * @returns The caller's profile after the removal.
   * @throws NotFoundException if the token names a row that no longer exists.
   */
  async removeAvatar(userId: string): Promise<ProfileResponseDto> {
    const current = await this.findUser(userId);
    if (current.avatarKey === null) {
      return this.toResponse(current);
    }

    const cleared = await this.commandBus.execute<
      UpdateUserAvatarCommand,
      User
    >(new UpdateUserAvatarCommand(userId, null));
    await this.deleteBytes(current.avatarKey);

    return this.toResponse(cleared);
  }

  /**
   * Resolves the caller's own avatar to the bytes a route can serve: the key
   * comes from the caller's own row and never from the request, so there is
   * nothing to point at another account's image (AC-15, D-8).
   *
   * The type served is the one detection wrote at upload time, not anything
   * the caller declared then or asks for now (D-6).
   * @param userId - The caller's id, taken from the verified token.
   * @returns The local path of the stored bytes and their stored type.
   * @throws NotFoundException if the row no longer exists, or holds no avatar (AC-9).
   * @throws InternalServerErrorException if the storage backend has no local path.
   */
  async getAvatarFile(
    userId: string,
  ): Promise<{ path: string; mimeType: string }> {
    const user = await this.findUser(userId);
    if (user.avatarKey === null) {
      throw new NotFoundException('Avatar not found');
    }

    const path = this.storage.localPathFor(user.avatarKey);
    if (path === null) {
      // Every bound FileStorage today has a local path; a backend without
      // one needs a streamed fallback rather than a guessed path.
      throw new InternalServerErrorException('Avatar is not readable');
    }

    return {
      path,
      // The four columns are written as one group (D-5), so a row holding a
      // key holds its type too; the fallback is for a row no code path
      // produces rather than a type the caller gets to influence.
      mimeType: user.avatarMimeType ?? 'application/octet-stream',
    };
  }

  /**
   * Reads the caller's own row over the users module's query bus.
   * @param userId - The caller's id, taken from the verified token.
   * @returns The caller's user row.
   * @throws NotFoundException if the token names a row that no longer exists.
   */
  private async findUser(userId: string): Promise<User> {
    const user = await this.queryBus.execute<FindUserByIdQuery, User | null>(
      new FindUserByIdQuery(userId),
    );
    if (!user) {
      throw new NotFoundException('Profile not found');
    }

    return user;
  }

  /**
   * Deletes bytes that nothing references any more, best-effort: a failure
   * leaves an unreachable object on disk, which is the accepted residual of
   * D-7's ordering, and is logged as a count only — never as a key, since a
   * key is exactly what S-1 keeps off every other surface.
   * @param key - The storage key whose bytes are no longer referenced.
   */
  private async deleteBytes(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch {
      this.logger.warn(
        'Failed to delete 1 unreferenced avatar object; it is orphaned under the storage root.',
      );
    }
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
      // Derived rather than stored, and derived from the key's presence
      // rather than the key itself — that is what keeps STORAGE_ROOT's
      // layout off the wire while still telling the caller they have one
      // (D-5, S-1).
      hasAvatar: user.avatarKey !== null,
      avatarUpdatedAt: user.avatarUpdatedAt,
    };
  }
}
