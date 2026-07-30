import { Command } from '@nestjs/cqrs';

/**
 * Command to produce a bcrypt hash of a plaintext password.
 */
export class HashPasswordCommand extends Command<string> {
  /**
   * @param password - The plaintext password to hash.
   */
  constructor(public readonly password: string) {
    super();
  }
}
