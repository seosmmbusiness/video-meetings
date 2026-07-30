import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import * as bcrypt from 'bcrypt';
import { HashPasswordCommand } from './hash-password.command';

const BCRYPT_SALT_ROUNDS = 12;

/**
 * Handles {@link HashPasswordCommand} by bcrypt-hashing the password.
 */
@CommandHandler(HashPasswordCommand)
export class HashPasswordHandler implements ICommandHandler<HashPasswordCommand> {
  /**
   * Hashes a plaintext password.
   * @param command - The password to hash.
   * @returns The bcrypt hash.
   */
  execute(command: HashPasswordCommand): Promise<string> {
    return bcrypt.hash(command.password, BCRYPT_SALT_ROUNDS);
  }
}
