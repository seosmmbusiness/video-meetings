import { Module } from '@nestjs/common';
import { CreateUserHandler } from './commands/create-user.handler';
import { FindUserByEmailHandler } from './queries/find-user-by-email.handler';
import { FindUserByIdHandler } from './queries/find-user-by-id.handler';

const CommandHandlers = [CreateUserHandler];
const QueryHandlers = [FindUserByEmailHandler, FindUserByIdHandler];

/**
 * Owns user persistence (the Prisma `User` model): creation and lookup.
 * Exposed to other modules exclusively via CQRS commands/queries (see
 * `commands/` and `queries/`), never via direct service injection.
 */
@Module({
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class UsersModule {}
