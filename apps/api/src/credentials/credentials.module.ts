import { Module } from '@nestjs/common';
import { HashPasswordHandler } from './commands/hash-password.handler';
import { VerifyPasswordHandler } from './queries/verify-password.handler';

const CommandHandlers = [HashPasswordHandler];
const QueryHandlers = [VerifyPasswordHandler];

/**
 * Owns password hashing/verification (bcrypt), including the timing-safe
 * dummy-hash comparison used when no matching user exists. Exposed to other
 * modules exclusively via CQRS commands/queries.
 */
@Module({
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class CredentialsModule {}
