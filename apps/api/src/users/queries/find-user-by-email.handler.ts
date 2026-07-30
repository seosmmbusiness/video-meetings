import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { User } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FindUserByEmailQuery } from './find-user-by-email.query';

/**
 * Handles {@link FindUserByEmailQuery} by looking up a user by email.
 */
@QueryHandler(FindUserByEmailQuery)
export class FindUserByEmailHandler implements IQueryHandler<FindUserByEmailQuery> {
  /**
   * @param prisma - Database access for the `User` model.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Looks up a user by email address.
   * @param query - The email address to look up.
   * @returns The matching user, or `null` if none exists.
   */
  execute(query: FindUserByEmailQuery): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email: query.email } });
  }
}
