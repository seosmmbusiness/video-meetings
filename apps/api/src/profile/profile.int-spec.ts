import { randomUUID } from 'crypto';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { NotFoundException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommandBus, CqrsModule } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';
import type { User } from '../../generated/prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
// Imported from where the boundary lives today; task 3.3 lifts these two
// files into `src/storage` (D-4) and this import moves with them.
import { FileStorage } from '../files/storage/file-storage';
import { resolveStorageRoot } from '../files/storage/storage-root';
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

  /**
   * Stages an upload the way multer does — bytes written under
   * `<STORAGE_ROOT>/tmp` — and hands back the file shape the profile service
   * receives from the route.
   * @param bytes - The image content to stage.
   * @param mimeType - The detected type the route would have passed on.
   * @returns The staged file descriptor.
   */
  async function stageUpload(
    bytes: Buffer,
    mimeType = 'image/png',
  ): Promise<{ path: string; mimetype: string; size: number }> {
    const path = join(
      resolveStorageRoot(),
      'tmp',
      `avatar-int-${randomUUID()}`,
    );
    await writeFile(path, bytes);

    return { path, mimetype: mimeType, size: bytes.length };
  }

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

  describe('avatar (phase 3)', () => {
    let storage: FileStorage;
    /** Storage keys these cases committed, deleted afterwards so no bytes outlive the run. */
    const committedKeys: string[] = [];

    // Resolved here rather than beside the module, so the cases phase 1
    // already proved don't fail on a provider phase 3 is what adds.
    beforeAll(() => {
      storage = moduleRef.get(FileStorage);
    });

    afterAll(async () => {
      for (const key of committedKeys) {
        await storage.delete(key);
      }
    });

    it('writes the four columns as one group and commits the bytes under users/<id>/avatar/<uuid> (D-5, D-7)', async () => {
      const user = await createUser();
      const bytes = Buffer.from('the first avatar');

      const profile = await service.setAvatar(
        user.id,
        await stageUpload(bytes),
      );

      expect(profile.hasAvatar).toBe(true);
      expect(profile.avatarUpdatedAt).not.toBeNull();

      const row = await prisma.user.findUnique({ where: { id: user.id } });
      expect(row?.avatarKey).toMatch(
        new RegExp(
          `^users/${user.id}/avatar/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
        ),
      );
      expect(row?.avatarMimeType).toBe('image/png');
      expect(row?.avatarSize).toBe(bytes.length);
      expect(row?.avatarUpdatedAt).not.toBeNull();

      committedKeys.push(row?.avatarKey ?? '');
      expect(await storage.stat(row?.avatarKey ?? '')).toEqual({
        size: bytes.length,
      });
    });

    it("a replacement commits a fresh key and the previous key's bytes are gone (S-5, AC-6)", async () => {
      const user = await createUser();
      await service.setAvatar(user.id, await stageUpload(Buffer.from('old')));
      const firstKey =
        (await prisma.user.findUnique({ where: { id: user.id } }))?.avatarKey ??
        '';

      await service.setAvatar(
        user.id,
        await stageUpload(Buffer.from('the new one'), 'image/jpeg'),
      );

      const row = await prisma.user.findUnique({ where: { id: user.id } });
      committedKeys.push(row?.avatarKey ?? '');
      expect(row?.avatarKey).not.toBe(firstKey);
      expect(row?.avatarMimeType).toBe('image/jpeg');
      expect(row?.avatarSize).toBe('the new one'.length);

      // The replaced key's bytes no longer exist, so nothing can serve them
      // to anyone (AC-6's "no longer served").
      expect(await storage.stat(firstKey)).toBeNull();
      expect(await storage.stat(row?.avatarKey ?? '')).toEqual({
        size: 'the new one'.length,
      });
    });

    it('removal clears all four columns and deletes the bytes (AC-9, D-7)', async () => {
      const user = await createUser();
      await service.setAvatar(
        user.id,
        await stageUpload(Buffer.from('to be removed')),
      );
      const key =
        (await prisma.user.findUnique({ where: { id: user.id } }))?.avatarKey ??
        '';

      const profile = await service.removeAvatar(user.id);

      expect(profile.hasAvatar).toBe(false);
      expect(profile.avatarUpdatedAt).toBeNull();

      const row = await prisma.user.findUnique({ where: { id: user.id } });
      expect(row?.avatarKey).toBeNull();
      expect(row?.avatarMimeType).toBeNull();
      expect(row?.avatarSize).toBeNull();
      expect(row?.avatarUpdatedAt).toBeNull();
      expect(await storage.stat(key)).toBeNull();
    });

    it("touches only the caller's own row — a second account keeps its avatar (AC-15)", async () => {
      const alice = await createUser();
      const bob = await createUser();
      await service.setAvatar(alice.id, await stageUpload(Buffer.from('a')));
      await service.setAvatar(bob.id, await stageUpload(Buffer.from('b')));
      const bobKey =
        (await prisma.user.findUnique({ where: { id: bob.id } }))?.avatarKey ??
        '';
      committedKeys.push(bobKey);

      await service.removeAvatar(alice.id);

      expect((await service.getProfile(bob.id)).hasAvatar).toBe(true);
      expect(await storage.stat(bobKey)).toEqual({ size: 1 });
    });

    it('never carries the storage key or the hash into a response (S-1, AC-18)', async () => {
      const user = await createUser();

      const profile = await service.setAvatar(
        user.id,
        await stageUpload(Buffer.from('secret-keyed')),
      );
      const key =
        (await prisma.user.findUnique({ where: { id: user.id } }))?.avatarKey ??
        '';
      committedKeys.push(key);

      expect(Object.keys(profile).sort()).toEqual([...PROFILE_KEYS]);
      expect(JSON.stringify(profile)).not.toContain(key);
      expect(JSON.stringify(profile)).not.toContain(PASSWORD_HASH);
    });
  });
});
