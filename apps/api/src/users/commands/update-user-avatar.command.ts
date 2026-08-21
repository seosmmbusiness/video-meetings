import { Command } from '@nestjs/cqrs';
import type { User } from '../../../generated/prisma/client';

/**
 * The metadata one committed avatar carries: the storage key its bytes live
 * under, the content-sniffed type they turned out to be, and their size.
 */
export interface UserAvatar {
  /** Storage key the bytes were committed under, e.g. `users/<id>/avatar/<uuid>`. */
  key: string;
  /** The detected MIME type — never the client's declared one. */
  mimeType: string;
  /** Size of the committed bytes, in bytes. */
  size: number;
}

/**
 * Command to set (or clear) a user's avatar as one group of four columns.
 */
export class UpdateUserAvatarCommand extends Command<User> {
  /**
   * @param userId - The id of the user to update, taken from the verified token.
   * @param avatar - The committed avatar's metadata, or `null` to clear it.
   */
  constructor(
    public readonly userId: string,
    public readonly avatar: UserAvatar | null,
  ) {
    super();
  }
}
