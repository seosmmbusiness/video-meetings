import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommandBus, CqrsModule } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';
import type { User } from '../../generated/prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserCommand } from '../users/commands/create-user.command';
import { UsersModule } from '../users/users.module';
import { ProfileModule } from './profile.module';
import { ProfileService } from './profile.service';

const PASSWORD_HASH =
  '$2b$10$abcdefghijklmnopqrstuvwxyz012345678901234567890123';

/** The exact key set every profile response carries (AC-18, S-1). */
const PROFILE_KEYS = [
  'avatarUpdatedAt',
  'email',
  'hasAvatar',
  'id',
  'name',
] as const;

/**
 * Builds a fresh, never-before-registered email so a test can't collide with
 * another test or with a previous run against the same database.
 * @returns A unique email address.
 */
function uniqueEmail(): string {
  return `profile-int-${randomUUID()}@example.com`;
}

describe('Profile module (integration)', () => {
  let moduleRef: TestingModule;
  let service: ProfileService;
  let commandBus: CommandBus;
  let prisma: PrismaService;
  const createdEmails: string[] = [];

  /**
   * Creates a user row straight through the users module's command bus, so
   * the profile service reads a row it did not itself create.
   * @returns The created user row.
   */
  async function createUser(): Promise<User> {
    const email = uniqueEmail();
    createdEmails.push(email);

    return commandBus.execute<CreateUserCommand, User>(
      new CreateUserCommand(email, PASSWORD_HASH, true),
    );
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        // Same env wiring as AppModule: apps/api runs with cwd=apps/api and
        // the repo keeps a single .env two levels up.
        ConfigModule.forRoot({ isGlobal: true, envFilePath: '../../.env' }),
        CqrsModule.forRoot(),
        PrismaModule,
        UsersModule,
        ProfileModule,
      ],
    }).compile();

    // init() runs the lifecycle hooks this tier depends on: PrismaService's
    // onModuleInit ($connect) and CQRS's handler registration.
    await moduleRef.init();

    service = moduleRef.get(ProfileService);
    commandBus = moduleRef.get(CommandBus);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    if (createdEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    }
    await moduleRef.close();
  });

  it('reads a real row over the users module query bus, mapped to the five keys', async () => {
    const user = await createUser();

    const profile = await service.getProfile(user.id);

    expect(Object.keys(profile).sort()).toEqual([...PROFILE_KEYS]);
    expect(profile).toEqual({
      id: user.id,
      email: user.email,
      name: null,
      hasAvatar: false,
      avatarUpdatedAt: null,
    });
  });

  it('writes the name through the users module command bus and reads it back', async () => {
    const user = await createUser();

    const updated = await service.updateProfile(user.id, { name: 'Alice' });

    expect(updated.name).toBe('Alice');
    expect((await service.getProfile(user.id)).name).toBe('Alice');
    expect(
      (await prisma.user.findUnique({ where: { id: user.id } }))?.name,
    ).toBe('Alice');
  });

  it('stores an empty name as NULL, which is how a name is cleared (AC-4)', async () => {
    const user = await createUser();
    await service.updateProfile(user.id, { name: 'Alice' });

    const cleared = await service.updateProfile(user.id, { name: '' });

    expect(cleared.name).toBeNull();
    expect(
      (await prisma.user.findUnique({ where: { id: user.id } }))?.name,
    ).toBeNull();
  });

  it("touches only the caller's own row — a second account keeps its name (AC-15)", async () => {
    const alice = await createUser();
    const bob = await createUser();
    await service.updateProfile(alice.id, { name: 'Alice' });

    await service.updateProfile(bob.id, { name: 'Bob' });

    expect((await service.getProfile(alice.id)).name).toBe('Alice');
    expect((await service.getProfile(bob.id)).name).toBe('Bob');
  });

  it('leaves the stored password hash out of every response (S-1)', async () => {
    const user = await createUser();

    const updated = await service.updateProfile(user.id, { name: 'Alice' });
    const read = await service.getProfile(user.id);

    for (const profile of [updated, read]) {
      expect(JSON.stringify(profile)).not.toContain(PASSWORD_HASH);
      expect(profile).not.toHaveProperty('passwordHash');
      expect(profile).not.toHaveProperty('tokenVersion');
    }
    expect(
      (await prisma.user.findUnique({ where: { id: user.id } }))?.passwordHash,
    ).toBe(PASSWORD_HASH);
  });

  it('answers NotFound for a token naming a row that no longer exists', async () => {
    await expect(service.getProfile(randomUUID())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
