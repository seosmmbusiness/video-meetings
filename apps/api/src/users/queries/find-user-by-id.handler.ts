import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { User } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FindUserByIdQuery } from './find-user-by-id.query';

/**
 * Handles {@link FindUserByIdQuery} by looking up a user by id.
 */
@QueryHandler(FindUserByIdQuery)
export class FindUserByIdHandler implements IQueryHandler<FindUserByIdQuery> {
  /**
   * @param prisma - Database access for the `User` model.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Looks up a user by id, returning the whole row. The full row is
   * deliberate: `JwtStrategy` reads `tokenVersion` off this query, so the
   * response DTO — not this handler — is the boundary that keeps
   * `passwordHash` and the avatar key off the wire.
   * @param query - The id to look up.
   * @returns The matching user, or `null` if none exists.
   */
  execute(query: FindUserByIdQuery): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id: query.userId } });
  }
}
