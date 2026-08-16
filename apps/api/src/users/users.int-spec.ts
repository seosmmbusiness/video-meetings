import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommandBus, CqrsModule, QueryBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';
import type { User } from '../../generated/prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserCommand } from './commands/create-user.command';
import { FindUserByEmailQuery } from './queries/find-user-by-email.query';
import { UsersModule } from './users.module';

const PASSWORD_HASH =
  '$2b$10$abcdefghijklmnopqrstuvwxyz012345678901234567890123';

/**
 * Builds a fresh, never-before-registered email so a test can't collide with
 * another test or with a previous run against the same database.
 * @returns A unique email address.
 */
function uniqueEmail(): string {
  return `users-int-${randomUUID()}@example.com`;
}

describe('Users module (integration)', () => {
  let moduleRef: TestingModule;
  let commandBus: CommandBus;
  let queryBus: QueryBus;
  let prisma: PrismaService;
  const createdEmails: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        // Same env wiring as AppModule: apps/api runs with cwd=apps/api and
        // the repo keeps a single .env two levels up.
        ConfigModule.forRoot({ isGlobal: true, envFilePath: '../../.env' }),
        CqrsModule.forRoot(),
        PrismaModule,
        UsersModule,
      ],
    }).compile();

    // init() runs the lifecycle hooks this tier depends on: PrismaService's
    // onModuleInit ($connect) and CQRS's handler registration.
    await moduleRef.init();

    commandBus = moduleRef.get(CommandBus);
    queryBus = moduleRef.get(QueryBus);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    if (createdEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    }
    await moduleRef.close();
  });

  it('persists a user through the command bus and reads it back through the query bus', async () => {
    const email = uniqueEmail();
    createdEmails.push(email);

    const created = await commandBus.execute<CreateUserCommand, User>(
      new CreateUserCommand(email, PASSWORD_HASH, true),
    );
    const found = await queryBus.execute<FindUserByEmailQuery, User | null>(
      new FindUserByEmailQuery(email),
    );

    expect(created.email).toBe(email);
    expect(found?.id).toBe(created.id);
    expect(found?.passwordHash).toBe(PASSWORD_HASH);
    expect(found?.consentToTerms).toBe(true);
  });

  it('resolves an unknown email to null rather than throwing', async () => {
    const found = await queryBus.execute<FindUserByEmailQuery, User | null>(
      new FindUserByEmailQuery(uniqueEmail()),
    );

    expect(found).toBeNull();
  });

  it("translates the database's unique-email constraint into a 409", async () => {
    // The handler's P2002 branch is only reachable against a real database:
    // it's the unique index on User.email, not the handler's own logic, that
    // rejects the second insert.
    const email = uniqueEmail();
    createdEmails.push(email);

    await commandBus.execute(new CreateUserCommand(email, PASSWORD_HASH, true));

    await expect(
      commandBus.execute(new CreateUserCommand(email, PASSWORD_HASH, true)),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
