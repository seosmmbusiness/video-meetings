import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

const STRONG_PASSWORD = 'Str0ngPass!';

/** The exact key set every profile response carries (AC-18, S-1). */
const PROFILE_KEYS = [
  'avatarUpdatedAt',
  'email',
  'hasAvatar',
  'id',
  'name',
] as const;

interface ProfileResponseBody {
  id: string;
  email: string;
  name: string | null;
  hasAvatar: boolean;
  avatarUpdatedAt: string | null;
}

/**
 * Builds a fresh, never-before-registered email so registration doesn't
 * collide across tests or previous runs against the same database.
 * @returns A unique email address.
 */
function uniqueEmail(): string {
  return `profile-e2e-${randomUUID()}@example.com`;
}

describe('Profile (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Registers a brand-new user and returns their access token.
   * @returns A signed JWT for a freshly registered user.
   */
  async function registerUser(): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: uniqueEmail(),
        password: STRONG_PASSWORD,
        consentToTerms: true,
      })
      .expect(201);

    return (response.body as { accessToken: string }).accessToken;
  }

  /**
   * Reads the caller's profile through `GET /profile`.
   * @param token - The caller's access token.
   * @returns The profile response body.
   */
  async function getProfile(token: string): Promise<ProfileResponseBody> {
    const response = await request(app.getHttpServer())
      .get('/profile')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    return response.body as ProfileResponseBody;
  }

  describe('GET /profile', () => {
    it('rejects the request when no auth token is provided', async () => {
      await request(app.getHttpServer()).get('/profile').expect(401);
    });

    it('rejects the request with an invalid auth token', async () => {
      await request(app.getHttpServer())
        .get('/profile')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);
    });

    it('returns the caller their own profile with exactly the five keys', async () => {
      const token = await registerUser();

      const response = await request(app.getHttpServer())
        .get('/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as ProfileResponseBody;
      expect(Object.keys(body).sort()).toEqual([...PROFILE_KEYS]);
      expect(body.name).toBeNull();
      expect(body.hasAvatar).toBe(false);
      expect(body.avatarUpdatedAt).toBeNull();
    });
  });

  describe('PATCH /profile', () => {
    it('rejects the request when no auth token is provided', async () => {
      await request(app.getHttpServer())
        .patch('/profile')
        .send({ name: 'Alice' })
        .expect(401);
    });

    it('rejects the request with an invalid auth token', async () => {
      await request(app.getHttpServer())
        .patch('/profile')
        .set('Authorization', 'Bearer not-a-real-token')
        .send({ name: 'Alice' })
        .expect(401);
    });

    it("sets the caller's name and returns it on the next read (AC-2)", async () => {
      const token = await registerUser();

      const response = await request(app.getHttpServer())
        .patch('/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Alice Example' })
        .expect(200);

      const body = response.body as ProfileResponseBody;
      expect(Object.keys(body).sort()).toEqual([...PROFILE_KEYS]);
      expect(body.name).toBe('Alice Example');

      expect((await getProfile(token)).name).toBe('Alice Example');
    });

    it('stores an 80-character name trimmed (AC-3)', async () => {
      const token = await registerUser();
      const name = 'a'.repeat(80);

      await request(app.getHttpServer())
        .patch('/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `   ${name}   ` })
        .expect(200);

      expect((await getProfile(token)).name).toBe(name);
    });

    it('rejects an 81-character name with the limit named, leaving the stored value unchanged (AC-3)', async () => {
      const token = await registerUser();

      await request(app.getHttpServer())
        .patch('/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Alice Example' })
        .expect(200);

      const response = await request(app.getHttpServer())
        .patch('/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'b'.repeat(81) })
        .expect(400);

      expect(JSON.stringify(response.body)).toContain(
        'Name must be 80 characters or fewer.',
      );
      expect((await getProfile(token)).name).toBe('Alice Example');
    });

    it('clears the name when an empty value is submitted (AC-4)', async () => {
      const token = await registerUser();

      await request(app.getHttpServer())
        .patch('/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Alice Example' })
        .expect(200);

      const response = await request(app.getHttpServer())
        .patch('/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '   ' })
        .expect(200);

      expect((response.body as ProfileResponseBody).name).toBeNull();
      expect((await getProfile(token)).name).toBeNull();
    });

    it('sanitises a name carrying a NUL byte instead of failing (S-2)', async () => {
      const token = await registerUser();

      const response = await request(app.getHttpServer())
        .patch('/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Al\u0000ice' })
        .expect(200);

      expect((response.body as ProfileResponseBody).name).toBe('Alice');
      expect((await getProfile(token)).name).toBe('Alice');
    });

    it('does not accept an unknown field as part of the update (mass assignment)', async () => {
      const token = await registerUser();

      const response = await request(app.getHttpServer())
        .patch('/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Alice Example', isAdmin: true, passwordHash: 'nope' })
        .expect(200);

      const body = response.body as ProfileResponseBody;
      expect(Object.keys(body).sort()).toEqual([...PROFILE_KEYS]);
      expect(body.name).toBe('Alice Example');
      expect(Object.keys(await getProfile(token)).sort()).toEqual([
        ...PROFILE_KEYS,
      ]);
    });

    it('never accepts a path segment as the subject — there is no /profile/:id (AC-15)', async () => {
      const tokenA = await registerUser();
      const tokenB = await registerUser();

      await request(app.getHttpServer())
        .patch('/profile')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Account A' })
        .expect(200);

      const profileA = await getProfile(tokenA);

      await request(app.getHttpServer())
        .get(`/profile/${profileA.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
    });

    it("a second account's token reaches nothing of the first account's profile (AC-15)", async () => {
      const tokenA = await registerUser();
      const tokenB = await registerUser();

      await request(app.getHttpServer())
        .patch('/profile')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Account A' })
        .expect(200);

      const profileA = await getProfile(tokenA);

      // B cannot name A as the subject through the body, and its own update
      // touches only its own row.
      const patchedB = await request(app.getHttpServer())
        .patch('/profile')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Account B', id: profileA.id, userId: profileA.id })
        .expect(200);

      expect((patchedB.body as ProfileResponseBody).id).not.toBe(profileA.id);
      expect((patchedB.body as ProfileResponseBody).name).toBe('Account B');

      const profileB = await getProfile(tokenB);
      expect(profileB.id).not.toBe(profileA.id);
      expect(profileB.email).not.toBe(profileA.email);
      expect(profileB.name).toBe('Account B');

      expect((await getProfile(tokenA)).name).toBe('Account A');
    });
  });
});
