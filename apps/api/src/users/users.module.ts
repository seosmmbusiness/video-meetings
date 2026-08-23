import { Module } from '@nestjs/common';
import { CreateUserHandler } from './commands/create-user.handler';
import { UpdateUserAvatarHandler } from './commands/update-user-avatar.handler';
import { UpdateUserNameHandler } from './commands/update-user-name.handler';
import { UpdateUserPasswordHandler } from './commands/update-user-password.handler';
import { FindUserByEmailHandler } from './queries/find-user-by-email.handler';
import { FindUserByIdHandler } from './queries/find-user-by-id.handler';

const CommandHandlers = [
  CreateUserHandler,
  UpdateUserNameHandler,
  UpdateUserAvatarHandler,
  UpdateUserPasswordHandler,
];
const QueryHandlers = [FindUserByEmailHandler, FindUserByIdHandler];

/**
 * Owns user persistence (the Prisma `User` model): creation, lookup, and the
 * display-name, avatar and credential updates.
 * Exposed to other modules exclusively via CQRS commands/queries (see
 * `commands/` and `queries/`), never via direct service injection.
 */
@Module({
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class UsersModule {}
