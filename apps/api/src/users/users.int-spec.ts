import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommandBus, CqrsModule, QueryBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';
import type { User } from '../../generated/prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserCommand } from './commands/create-user.command';
import { UpdateUserNameCommand } from './commands/update-user-name.command';
import { FindUserByEmailQuery } from './queries/find-user-by-email.query';
import { FindUserByIdQuery } from './queries/find-user-by-id.query';
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

  describe('the profile columns on the users table', () => {
    it('leaves every profile column empty and tokenVersion at 0 on a fresh row', async () => {
      const email = uniqueEmail();
      createdEmails.push(email);

      const created = await commandBus.execute<CreateUserCommand, User>(
        new CreateUserCommand(email, PASSWORD_HASH, true),
      );

      // The migration adds these to a table that already holds registered
      // rows, so each one has to be satisfiable without a value.
      expect(created.name).toBeNull();
      expect(created.avatarKey).toBeNull();
      expect(created.avatarMimeType).toBeNull();
      expect(created.avatarSize).toBeNull();
      expect(created.avatarUpdatedAt).toBeNull();
      expect(created.tokenVersion).toBe(0);
    });

    it('stores an 80-character name and refuses an 81-character one at the column', async () => {
      const email = uniqueEmail();
      createdEmails.push(email);

      const created = await commandBus.execute<CreateUserCommand, User>(
        new CreateUserCommand(email, PASSWORD_HASH, true),
      );

      const updated = await prisma.user.update({
        where: { id: created.id },
        data: { name: 'a'.repeat(80) },
      });
      expect(updated.name).toBe('a'.repeat(80));

      // VarChar(80) is the last line that enforces the limit — the DTO is the
      // first, but the column has to refuse what ever gets past it (D-2).
      await expect(
        prisma.user.update({
          where: { id: created.id },
          data: { name: 'a'.repeat(81) },
        }),
      ).rejects.toBeDefined();
    });

    it('keeps avatarKey unique while letting every row leave it NULL', async () => {
      const emailA = uniqueEmail();
      const emailB = uniqueEmail();
      createdEmails.push(emailA, emailB);

      const userA = await commandBus.execute<CreateUserCommand, User>(
        new CreateUserCommand(emailA, PASSWORD_HASH, true),
      );
      const userB = await commandBus.execute<CreateUserCommand, User>(
        new CreateUserCommand(emailB, PASSWORD_HASH, true),
      );

      // Both rows already share a NULL avatarKey, which a unique index has to
      // allow; the same non-null key twice is what it must refuse (D-5).
      const avatarKey = `avatars/${randomUUID()}`;
      await prisma.user.update({
        where: { id: userA.id },
        data: { avatarKey },
      });

      await expect(
        prisma.user.update({ where: { id: userB.id }, data: { avatarKey } }),
      ).rejects.toBeDefined();
    });
  });

  describe('FindUserByIdQuery', () => {
    it('reads a user back by id through the query bus', async () => {
      const email = uniqueEmail();
      createdEmails.push(email);

      const created = await commandBus.execute<CreateUserCommand, User>(
        new CreateUserCommand(email, PASSWORD_HASH, true),
      );

      const found = await queryBus.execute<FindUserByIdQuery, User | null>(
        new FindUserByIdQuery(created.id),
      );

      expect(found?.id).toBe(created.id);
      expect(found?.email).toBe(email);
    });

    it('returns the whole row, hash and tokenVersion included', async () => {
      const email = uniqueEmail();
      createdEmails.push(email);

      const created = await commandBus.execute<CreateUserCommand, User>(
        new CreateUserCommand(email, PASSWORD_HASH, true),
      );
      await prisma.user.update({
        where: { id: created.id },
        data: { name: 'Ada Lovelace' },
      });

      const found = await queryBus.execute<FindUserByIdQuery, User | null>(
        new FindUserByIdQuery(created.id),
      );

      // The full row is deliberate (D-3): JwtStrategy reads tokenVersion off
      // this same query, so the response mapping — not this query — is what
      // keeps the hash off the wire (S-1).
      expect(found?.name).toBe('Ada Lovelace');
      expect(found?.passwordHash).toBe(PASSWORD_HASH);
      expect(found?.tokenVersion).toBe(0);
    });

    it('resolves an unknown id to null rather than throwing', async () => {
      const found = await queryBus.execute<FindUserByIdQuery, User | null>(
        new FindUserByIdQuery(randomUUID()),
      );

      expect(found).toBeNull();
    });

    it('never answers with another account when asked for one id', async () => {
      const emailA = uniqueEmail();
      const emailB = uniqueEmail();
      createdEmails.push(emailA, emailB);

      const userA = await commandBus.execute<CreateUserCommand, User>(
        new CreateUserCommand(emailA, PASSWORD_HASH, true),
      );
      const userB = await commandBus.execute<CreateUserCommand, User>(
        new CreateUserCommand(emailB, PASSWORD_HASH, true),
      );

      const found = await queryBus.execute<FindUserByIdQuery, User | null>(
        new FindUserByIdQuery(userB.id),
      );

      // The id the caller's token carries is the only key this query reads —
      // A's row stays unreachable through B's id and the other way round.
      expect(found?.id).toBe(userB.id);
      expect(found?.email).toBe(emailB);
      expect(found?.id).not.toBe(userA.id);
    });
  });

  describe('UpdateUserNameCommand', () => {
    it("writes the name onto the caller's own row and answers with the updated row", async () => {
      const email = uniqueEmail();
      createdEmails.push(email);

      const created = await commandBus.execute<CreateUserCommand, User>(
        new CreateUserCommand(email, PASSWORD_HASH, true),
      );

      const updated = await commandBus.execute<UpdateUserNameCommand, User>(
        new UpdateUserNameCommand(created.id, 'Ada Lovelace'),
      );

      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe('Ada Lovelace');
      await expect(
        prisma.user.findUnique({ where: { id: created.id } }),
      ).resolves.toMatchObject({ name: 'Ada Lovelace' });
    });

    it('stores an empty name as NULL — that is how a name is cleared (AC-4)', async () => {
      const email = uniqueEmail();
      createdEmails.push(email);

      const created = await commandBus.execute<CreateUserCommand, User>(
        new CreateUserCommand(email, PASSWORD_HASH, true),
      );
      await commandBus.execute<UpdateUserNameCommand, User>(
        new UpdateUserNameCommand(created.id, 'Ada Lovelace'),
      );

      // The DTO trims to '' rather than rejecting, so '' arriving here is the
      // caller clearing their name, not a missing value.
      const cleared = await commandBus.execute<UpdateUserNameCommand, User>(
        new UpdateUserNameCommand(created.id, ''),
      );

      expect(cleared.name).toBeNull();
    });

    it('stores an explicit null as NULL', async () => {
      const email = uniqueEmail();
      createdEmails.push(email);

      const created = await commandBus.execute<CreateUserCommand, User>(
        new CreateUserCommand(email, PASSWORD_HASH, true),
      );
      await commandBus.execute<UpdateUserNameCommand, User>(
        new UpdateUserNameCommand(created.id, 'Ada Lovelace'),
      );

      const cleared = await commandBus.execute<UpdateUserNameCommand, User>(
        new UpdateUserNameCommand(created.id, null),
      );

      expect(cleared.name).toBeNull();
    });

    it('stores an 80-character name the DTO already normalised', async () => {
      const email = uniqueEmail();
      createdEmails.push(email);

      const created = await commandBus.execute<CreateUserCommand, User>(
        new CreateUserCommand(email, PASSWORD_HASH, true),
      );
      const name = 'a'.repeat(80);

      const updated = await commandBus.execute<UpdateUserNameCommand, User>(
        new UpdateUserNameCommand(created.id, name),
      );

      expect(updated.name).toBe(name);
    });

    it('writes nothing to any other account (the id from the token is the only key)', async () => {
      const emailA = uniqueEmail();
      const emailB = uniqueEmail();
      createdEmails.push(emailA, emailB);

      const userA = await commandBus.execute<CreateUserCommand, User>(
        new CreateUserCommand(emailA, PASSWORD_HASH, true),
      );
      const userB = await commandBus.execute<CreateUserCommand, User>(
        new CreateUserCommand(emailB, PASSWORD_HASH, true),
      );

      await commandBus.execute<UpdateUserNameCommand, User>(
        new UpdateUserNameCommand(userB.id, 'Only B'),
      );

      await expect(
        prisma.user.findUnique({ where: { id: userA.id } }),
      ).resolves.toMatchObject({ name: null });
    });

    it('leaves the rest of the row alone', async () => {
      const email = uniqueEmail();
      createdEmails.push(email);

      const created = await commandBus.execute<CreateUserCommand, User>(
        new CreateUserCommand(email, PASSWORD_HASH, true),
      );

      const updated = await commandBus.execute<UpdateUserNameCommand, User>(
        new UpdateUserNameCommand(created.id, 'Ada Lovelace'),
      );

      // The name is the only column this command owns: the credential and the
      // revocation counter move through their own commands (D-3, D-9).
      expect(updated.email).toBe(email);
      expect(updated.passwordHash).toBe(PASSWORD_HASH);
      expect(updated.tokenVersion).toBe(0);
      expect(updated.avatarKey).toBeNull();
    });
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
