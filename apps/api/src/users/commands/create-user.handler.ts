import { ConflictException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Prisma } from '../../../generated/prisma/client';
import type { User } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserCommand } from './create-user.command';

const PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE = 'P2002';

/**
 * Handles {@link CreateUserCommand} by inserting a new user row.
 */
@CommandHandler(CreateUserCommand)
export class CreateUserHandler implements ICommandHandler<CreateUserCommand> {
  /**
   * @param prisma - Database access for the `User` model.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inserts a new user with the given (already-hashed) password.
   * @param command - Email, password hash, and terms consent for the new account.
   * @returns The created user.
   * @throws ConflictException if a user with the given email already exists.
   */
  async execute(command: CreateUserCommand): Promise<User> {
    const { email, passwordHash, consentToTerms } = command;
    try {
      return await this.prisma.user.create({
        data: { email, passwordHash, consentToTerms },
      });
    } catch (error) {
      // Callers are expected to have already checked for an existing user
      // via FindUserByEmailQuery, but two concurrent registrations for the
      // same email can both pass that check. The database's unique
      // constraint on email is the real guard; translate its violation into
      // the same 409 instead of letting a raw Prisma error escape as a 500.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE
      ) {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }
}
