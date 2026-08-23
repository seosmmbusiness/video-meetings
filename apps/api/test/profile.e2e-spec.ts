import { randomUUID } from 'crypto';
import * as http from 'http';
import { sign } from 'jsonwebtoken';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

const STRONG_PASSWORD = 'Str0ngPass!';

/** Largest avatar the API accepts, in bytes (D-6). */
const MAX_AVATAR_BYTES = 5_242_880;

/** Verbatim 413 message for an avatar over {@link MAX_AVATAR_BYTES} (AC-7). */
const AVATAR_SIZE_LIMIT_MESSAGE = 'Avatar exceeds the 5 MB limit.';

/** Verbatim 415 message for content outside the accepted set (AC-8). */
const AVATAR_TYPE_MESSAGE =
  'Unsupported image type. Accepted types: png, jpg, webp.';

/** Verbatim 403 message for a wrong current password (AC-11, D-11). */
const WRONG_CURRENT_PASSWORD_MESSAGE = 'Current password is incorrect.';

/** Attempts `PATCH /profile/password` allows per caller per minute (S-4, AC-20). */
const PASSWORD_ROUTE_LIMIT = 10;

/** The exact key set every profile response carries (AC-18, S-1). */
const PROFILE_KEYS = [
  'avatarUpdatedAt',
  'email',
  'hasAvatar',
  'id',
  'name',
] as const;

/**
 * A minimal but structurally valid PNG: the 8-byte signature, a well-formed
 * 13-byte `IHDR` chunk (the content detector parses the chunk length before
 * it will report a match) and an empty `IDAT` chunk.
 * @returns The PNG byte sequence.
 */
function pngBytes(): Buffer {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const ihdrChunk = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x0d]), // length: 13
    Buffer.from('IHDR', 'latin1'),
    Buffer.alloc(13),
    Buffer.alloc(4), // CRC, not validated by the detector
  ]);
  const idatChunk = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x00]), // length: 0
    Buffer.from('IDAT', 'latin1'),
    Buffer.alloc(4), // CRC, not validated by the detector
  ]);
  return Buffer.concat([signature, ihdrChunk, idatChunk]);
}

/**
 * A JFIF-headed JPEG: the SOI marker, an APP0 segment and the EOI marker.
 * @returns The JPEG byte sequence.
 */
function jpegBytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    Buffer.from('JFIF\0', 'latin1'),
    Buffer.from([0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

/**
 * A RIFF container declaring the `WEBP` form type, which is what the content
 * detector matches on.
 * @returns The WebP byte sequence.
 */
function webpBytes(): Buffer {
  const payload = Buffer.concat([
    Buffer.from('WEBPVP8 ', 'latin1'),
    Buffer.alloc(16),
  ]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(payload.length, 0);
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), size, payload]);
}

/**
 * A real PDF header — a detectable format that is deliberately outside the
 * accepted image set, used for AC-8's renamed-extension case.
 * @returns The PDF byte sequence.
 */
function pdfBytes(): Buffer {
  return Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n', 'latin1');
}

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
  /** Real TCP port the app is bound to — needed by the raw-socket case that declares a `Content-Length` it never sends. */
  let port: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    await app.listen(0);
    const address = (app.getHttpServer() as http.Server).address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected the test server to bind a TCP port');
    }
    port = address.port;
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Registers a brand-new user and returns both halves of the account: the
   * email a later `/auth/login` needs, and the token it was issued.
   *
   * Every registration in this suite draws on the one unauthenticated
   * throttle bucket the whole run shares by IP, so a case reuses an account
   * wherever the scenario allows it rather than registering a fresh one.
   * @returns The registered email and a signed JWT for it.
   */
  async function registerAccount(): Promise<{ email: string; token: string }> {
    const email = uniqueEmail();
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: STRONG_PASSWORD, consentToTerms: true })
      .expect(201);

    return {
      email,
      token: (response.body as { accessToken: string }).accessToken,
    };
  }

  /**
   * Registers a brand-new user and returns their access token.
   * @returns A signed JWT for a freshly registered user.
   */
  async function registerUser(): Promise<string> {
    return (await registerAccount()).token;
  }

  /**
   * Attempts a login, unasserted so a case can check its status itself.
   * @param email - The account's email.
   * @param password - The password to try.
   * @returns The supertest response.
   */
  function login(email: string, password: string): request.Test {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
  }

  /**
   * Sends a password change on behalf of `token`, unasserted so a case can
   * check its status itself.
   * @param token - The caller's access token.
   * @param body - The request body, including any field a case wants to smuggle.
   * @returns The supertest response.
   */
  function changePassword(
    token: string,
    body: Record<string, unknown>,
  ): request.Test {
    return request(app.getHttpServer())
      .patch('/profile/password')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  /**
   * Signs a token that expired the moment it was issued, so the expired-JWT
   * half of the auth-bypass case is exercised rather than assumed.
   * @returns A correctly signed but already-expired access token.
   */
  function expiredToken(): string {
    return sign(
      { sub: randomUUID(), email: uniqueEmail() },
      process.env.JWT_SECRET ?? '',
      { expiresIn: -1 },
    );
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

  /**
   * Uploads `bytes` as the caller's avatar.
   * @param token - The caller's access token.
   * @param bytes - The image content to send.
   * @param name - The file name to declare.
   * @returns The supertest response, unasserted so a case can check its status.
   */
  function uploadAvatar(
    token: string,
    bytes: Buffer,
    name: string,
  ): request.Test {
    return request(app.getHttpServer())
      .post('/profile/avatar')
      .set('Authorization', `Bearer ${token}`)
      .attach('avatar', bytes, name);
  }

  /**
   * Sends a `POST /profile/avatar` that declares `contentLength` in its
   * header and then ends the request without a body, so the declared-size
   * gate is exercised at zero bytes read (D-6, gate 1).
   * @param token - The caller's access token.
   * @param contentLength - The `Content-Length` value to declare.
   * @returns The response status and raw body.
   */
  function declareAvatarUpload(
    token: string,
    contentLength: number,
  ): Promise<{ statusCode: number; body: string }> {
    const boundary = `----avatar${randomUUID()}`;

    return new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: '/profile/avatar',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': contentLength,
        },
      });
      req.on('error', reject);
      req.on('response', (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
          req.destroy();
        });
      });
      req.end();
    });
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

    it('rejects the request with an expired auth token', async () => {
      await request(app.getHttpServer())
        .get('/profile')
        .set('Authorization', `Bearer ${expiredToken()}`)
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

    it('rejects the request with an expired auth token', async () => {
      await request(app.getHttpServer())
        .patch('/profile')
        .set('Authorization', `Bearer ${expiredToken()}`)
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

  // The avatar routes share two registered accounts, because every
  // registration in this suite draws on the one unauthenticated throttle
  // bucket the whole run has (see the root CLAUDE.md's e2e note).
  describe('Avatar routes (phase 3)', () => {
    let tokenA: string;
    let tokenB: string;

    beforeAll(async () => {
      tokenA = await registerUser();
      tokenB = await registerUser();
    });

    /**
     * Returns both accounts to "no avatar" without asserting anything about
     * how a removal with nothing stored answers — that is not a behaviour
     * this task pins down.
     */
    beforeEach(async () => {
      for (const token of [tokenA, tokenB]) {
        await request(app.getHttpServer())
          .delete('/profile/avatar')
          .set('Authorization', `Bearer ${token}`);
      }
    });

    describe('POST /profile/avatar', () => {
      it('rejects the request when no auth token is provided', async () => {
        await request(app.getHttpServer())
          .post('/profile/avatar')
          .attach('avatar', pngBytes(), 'a.png')
          .expect(401);
      });

      it('rejects the request with an invalid auth token', async () => {
        await uploadAvatar('not-a-real-token', pngBytes(), 'a.png').expect(401);
      });

      it('rejects the request with an expired auth token', async () => {
        await uploadAvatar(expiredToken(), pngBytes(), 'a.png').expect(401);
      });

      it('stores a PNG and answers 201 with exactly the five profile keys (AC-6, AC-18)', async () => {
        const response = await uploadAvatar(
          tokenA,
          pngBytes(),
          'avatar.png',
        ).expect(201);

        const body = response.body as ProfileResponseBody;
        expect(Object.keys(body).sort()).toEqual([...PROFILE_KEYS]);
        expect(body.hasAvatar).toBe(true);
        expect(body.avatarUpdatedAt).not.toBeNull();

        const read = await getProfile(tokenA);
        expect(read.hasAvatar).toBe(true);
        expect(read.avatarUpdatedAt).toBe(body.avatarUpdatedAt);
      });

      it('accepts a JPEG and a WebP by their content (AC-6)', async () => {
        const jpeg = await uploadAvatar(tokenA, jpegBytes(), 'a.jpg').expect(
          201,
        );
        expect((jpeg.body as ProfileResponseBody).hasAvatar).toBe(true);
        await request(app.getHttpServer())
          .get('/profile/avatar')
          .set('Authorization', `Bearer ${tokenA}`)
          .expect(200)
          .expect('Content-Type', /image\/jpeg/);

        const webp = await uploadAvatar(tokenA, webpBytes(), 'a.webp').expect(
          200,
        );
        expect((webp.body as ProfileResponseBody).hasAvatar).toBe(true);
        await request(app.getHttpServer())
          .get('/profile/avatar')
          .set('Authorization', `Bearer ${tokenA}`)
          .expect(200)
          .expect('Content-Type', /image\/webp/);
      });

      it('answers 200 when it replaces an existing avatar, moving avatarUpdatedAt forward (AC-6)', async () => {
        const first = (
          await uploadAvatar(tokenA, pngBytes(), 'first.png').expect(201)
        ).body as ProfileResponseBody;

        const second = (
          await uploadAvatar(tokenA, jpegBytes(), 'second.jpg').expect(200)
        ).body as ProfileResponseBody;

        expect(Object.keys(second).sort()).toEqual([...PROFILE_KEYS]);
        expect(second.hasAvatar).toBe(true);
        expect(
          new Date(second.avatarUpdatedAt ?? 0).getTime(),
        ).toBeGreaterThanOrEqual(
          new Date(first.avatarUpdatedAt ?? 0).getTime(),
        );

        // The reader sees the replacement, never a half-written previous
        // image: the served bytes are the second upload's (D-7).
        await request(app.getHttpServer())
          .get('/profile/avatar')
          .set('Authorization', `Bearer ${tokenA}`)
          .expect(200)
          .expect('Content-Type', /image\/jpeg/);
      });

      it('refuses a declared Content-Length over 5 MB with 413 at zero bytes read (AC-7)', async () => {
        const { statusCode, body } = await declareAvatarUpload(
          tokenA,
          MAX_AVATAR_BYTES + 1,
        );

        expect(statusCode).toBe(413);
        expect((JSON.parse(body) as { message: string }).message).toBe(
          AVATAR_SIZE_LIMIT_MESSAGE,
        );
        expect((await getProfile(tokenA)).hasAvatar).toBe(false);
      });

      it('refuses a body of 5 MB + 1 byte with 413, leaving the stored avatar untouched (AC-7)', async () => {
        const stored = (
          await uploadAvatar(tokenA, pngBytes(), 'keep.png').expect(201)
        ).body as ProfileResponseBody;

        const oversized = Buffer.concat([
          pngBytes(),
          Buffer.alloc(MAX_AVATAR_BYTES + 1 - pngBytes().length),
        ]);
        const response = await uploadAvatar(
          tokenA,
          oversized,
          'huge.png',
        ).expect(413);

        expect((response.body as { message: string }).message).toBe(
          AVATAR_SIZE_LIMIT_MESSAGE,
        );

        const after = await getProfile(tokenA);
        expect(after.hasAvatar).toBe(true);
        expect(after.avatarUpdatedAt).toBe(stored.avatarUpdatedAt);
        await request(app.getHttpServer())
          .get('/profile/avatar')
          .set('Authorization', `Bearer ${tokenA}`)
          .expect(200)
          .expect('Content-Type', /image\/png/);
      });

      it('refuses a PDF renamed .png with 415 naming the accepted types, storing nothing (AC-8)', async () => {
        const response = await uploadAvatar(
          tokenA,
          pdfBytes(),
          'not-really.png',
        ).expect(415);

        expect((response.body as { message: string }).message).toBe(
          AVATAR_TYPE_MESSAGE,
        );

        const after = await getProfile(tokenA);
        expect(after.hasAvatar).toBe(false);
        expect(after.avatarUpdatedAt).toBeNull();
        await request(app.getHttpServer())
          .get('/profile/avatar')
          .set('Authorization', `Bearer ${tokenA}`)
          .expect(404);
      });

      it('leaves an existing avatar readable when a replacement is refused for its type (AC-8)', async () => {
        const stored = (
          await uploadAvatar(tokenA, pngBytes(), 'keep.png').expect(201)
        ).body as ProfileResponseBody;

        await uploadAvatar(tokenA, pdfBytes(), 'swap.png').expect(415);

        const after = await getProfile(tokenA);
        expect(after.hasAvatar).toBe(true);
        expect(after.avatarUpdatedAt).toBe(stored.avatarUpdatedAt);
        await request(app.getHttpServer())
          .get('/profile/avatar')
          .set('Authorization', `Bearer ${tokenA}`)
          .expect(200)
          .expect('Content-Type', /image\/png/);
      });

      it('ignores extra multipart fields naming another account (mass assignment, AC-15, AC-18)', async () => {
        const profileA = await getProfile(tokenA);

        const response = await request(app.getHttpServer())
          .post('/profile/avatar')
          .set('Authorization', `Bearer ${tokenB}`)
          .field('userId', profileA.id)
          .field('id', profileA.id)
          .attach('avatar', pngBytes(), 'b.png')
          .expect(201);

        const body = response.body as ProfileResponseBody;
        expect(Object.keys(body).sort()).toEqual([...PROFILE_KEYS]);
        expect(body.id).not.toBe(profileA.id);
        expect((await getProfile(tokenA)).hasAvatar).toBe(false);
      });
    });

    describe('GET /profile/avatar', () => {
      it('rejects the request when no auth token is provided', async () => {
        await request(app.getHttpServer()).get('/profile/avatar').expect(401);
      });

      it('rejects the request with an invalid auth token', async () => {
        await request(app.getHttpServer())
          .get('/profile/avatar')
          .set('Authorization', 'Bearer not-a-real-token')
          .expect(401);
      });

      it('rejects the request with an expired auth token', async () => {
        await request(app.getHttpServer())
          .get('/profile/avatar')
          .set('Authorization', `Bearer ${expiredToken()}`)
          .expect(401);
      });

      it('answers 404 when the account has no avatar (AC-9)', async () => {
        await request(app.getHttpServer())
          .get('/profile/avatar')
          .set('Authorization', `Bearer ${tokenA}`)
          .expect(404);
      });

      it('serves the owner their own bytes with the headers D-8 and T-1 name', async () => {
        const bytes = pngBytes();
        await uploadAvatar(tokenA, bytes, 'a.png').expect(201);

        const response = await request(app.getHttpServer())
          .get('/profile/avatar')
          .set('Authorization', `Bearer ${tokenA}`)
          .expect(200);

        expect(response.headers['content-type']).toMatch(/image\/png/);
        expect(response.headers['content-disposition']).toBe('inline');
        expect(response.headers['x-content-type-options']).toBe('nosniff');
        expect(response.headers['cache-control']).toBe('private, max-age=60');
        expect(Buffer.from(response.body as Buffer).equals(bytes)).toBe(true);
      });

      it("answers B's own state, never A's bytes (AC-15)", async () => {
        const aBytes = pngBytes();
        await uploadAvatar(tokenA, aBytes, 'a.png').expect(201);

        // B has no avatar of its own: the only thing B's token can reach is
        // B's row, so the answer is a refusal rather than A's image.
        await request(app.getHttpServer())
          .get('/profile/avatar')
          .set('Authorization', `Bearer ${tokenB}`)
          .expect(404);

        const bBytes = jpegBytes();
        await uploadAvatar(tokenB, bBytes, 'b.jpg').expect(201);

        const asB = await request(app.getHttpServer())
          .get('/profile/avatar')
          .set('Authorization', `Bearer ${tokenB}`)
          .expect(200);

        expect(asB.headers['content-type']).toMatch(/image\/jpeg/);
        expect(Buffer.from(asB.body as Buffer).equals(bBytes)).toBe(true);
        expect(Buffer.from(asB.body as Buffer).equals(aBytes)).toBe(false);
      });

      it("has no id-bearing route to another account's bytes (AC-15)", async () => {
        await uploadAvatar(tokenA, pngBytes(), 'a.png').expect(201);
        const profileA = await getProfile(tokenA);

        await request(app.getHttpServer())
          .get(`/profile/avatar/${profileA.id}`)
          .set('Authorization', `Bearer ${tokenB}`)
          .expect(404);
      });
    });

    describe('DELETE /profile/avatar', () => {
      it('rejects the request when no auth token is provided', async () => {
        await request(app.getHttpServer())
          .delete('/profile/avatar')
          .expect(401);
      });

      it('rejects the request with an invalid auth token', async () => {
        await request(app.getHttpServer())
          .delete('/profile/avatar')
          .set('Authorization', 'Bearer not-a-real-token')
          .expect(401);
      });

      it('rejects the request with an expired auth token', async () => {
        await request(app.getHttpServer())
          .delete('/profile/avatar')
          .set('Authorization', `Bearer ${expiredToken()}`)
          .expect(401);
      });

      it('removes the avatar, and the read then answers 404 (AC-9, AC-18)', async () => {
        await uploadAvatar(tokenA, pngBytes(), 'a.png').expect(201);

        const response = await request(app.getHttpServer())
          .delete('/profile/avatar')
          .set('Authorization', `Bearer ${tokenA}`)
          .expect(200);

        const body = response.body as ProfileResponseBody;
        expect(Object.keys(body).sort()).toEqual([...PROFILE_KEYS]);
        expect(body.hasAvatar).toBe(false);
        expect(body.avatarUpdatedAt).toBeNull();

        await request(app.getHttpServer())
          .get('/profile/avatar')
          .set('Authorization', `Bearer ${tokenA}`)
          .expect(404);

        const read = await getProfile(tokenA);
        expect(read.hasAvatar).toBe(false);
        expect(read.avatarUpdatedAt).toBeNull();
      });

      it("removing A's avatar leaves B's avatar readable (AC-15)", async () => {
        await uploadAvatar(tokenA, pngBytes(), 'a.png').expect(201);
        const bBytes = jpegBytes();
        await uploadAvatar(tokenB, bBytes, 'b.jpg').expect(201);

        await request(app.getHttpServer())
          .delete('/profile/avatar')
          .set('Authorization', `Bearer ${tokenA}`)
          .expect(200);

        const asB = await request(app.getHttpServer())
          .get('/profile/avatar')
          .set('Authorization', `Bearer ${tokenB}`)
          .expect(200);
        expect(Buffer.from(asB.body as Buffer).equals(bBytes)).toBe(true);
        expect((await getProfile(tokenB)).hasAvatar).toBe(true);
      });
    });
  });

  // Four accounts, registered once: the whole suite shares one unauthenticated
  // register bucket by IP (see the root CLAUDE.md's e2e note), and each of
  // these cases needs a password whose history it alone controls.
  describe('PATCH /profile/password (phase 5)', () => {
    /** Changes its password, so nothing else may depend on its credential. */
    let changer: { email: string; token: string };
    /** Its password must survive every refusal aimed at it (AC-11, AC-12, AC-15). */
    let keeper: { email: string; token: string };
    /** Changes its own password while naming the keeper's id (AC-15). */
    let impostor: { email: string; token: string };
    /** Spends its whole route budget on wrong guesses (AC-20, S-4). */
    let hammer: { email: string; token: string };

    beforeAll(async () => {
      changer = await registerAccount();
      keeper = await registerAccount();
      impostor = await registerAccount();
      hammer = await registerAccount();
    }, 20_000);

    it('rejects the request when no auth token is provided', async () => {
      await request(app.getHttpServer())
        .patch('/profile/password')
        .send({
          currentPassword: STRONG_PASSWORD,
          newPassword: 'Unused0Password',
        })
        .expect(401);
    });

    it('rejects the request with an invalid auth token', async () => {
      await changePassword('not-a-real-token', {
        currentPassword: STRONG_PASSWORD,
        newPassword: 'Unused0Password',
      }).expect(401);
    });

    it('rejects the request with an expired auth token', async () => {
      await changePassword(expiredToken(), {
        currentPassword: STRONG_PASSWORD,
        newPassword: 'Unused0Password',
      }).expect(401);
    });

    describe('with the correct current password', () => {
      const NEW_PASSWORD = 'N3wStrongPass';
      /** A second session of the same account, opened before the change. */
      let otherSessionToken: string;
      /** The token the change was made with — also minted before it. */
      let preChangeToken: string;
      /** The token the change answered with. */
      let issuedToken: string;
      /** The whole response body of the change, for the key-set assertion. */
      let changeBody: Record<string, unknown>;

      beforeAll(async () => {
        preChangeToken = changer.token;
        const secondSession = await login(
          changer.email,
          STRONG_PASSWORD,
        ).expect(200);
        otherSessionToken = (secondSession.body as { accessToken: string })
          .accessToken;

        const response = await changePassword(preChangeToken, {
          currentPassword: STRONG_PASSWORD,
          newPassword: NEW_PASSWORD,
        }).expect(200);

        changeBody = response.body as Record<string, unknown>;
        issuedToken = changeBody.accessToken as string;
      }, 20_000);

      it('answers a body carrying exactly { accessToken } (AC-18, S-1)', () => {
        expect(Object.keys(changeBody)).toEqual(['accessToken']);
        expect(typeof issuedToken).toBe('string');
        expect(issuedToken.length).toBeGreaterThan(0);
      });

      it('lets the new password log in and refuses the old one (AC-10)', async () => {
        await login(changer.email, NEW_PASSWORD).expect(200);
        await login(changer.email, STRONG_PASSWORD).expect(401);
      });

      it('refuses both tokens minted before the change, while the one it issued still works (AC-13)', async () => {
        await request(app.getHttpServer())
          .get('/profile')
          .set('Authorization', `Bearer ${otherSessionToken}`)
          .expect(401);

        await request(app.getHttpServer())
          .get('/profile')
          .set('Authorization', `Bearer ${preChangeToken}`)
          .expect(401);

        const carriedOn = await request(app.getHttpServer())
          .get('/profile')
          .set('Authorization', `Bearer ${issuedToken}`)
          .expect(200);

        expect((carriedOn.body as ProfileResponseBody).email).toBe(
          changer.email,
        );
      });
    });

    it('refuses a wrong current password with 403, changing nothing and ending no session (AC-11)', async () => {
      const response = await changePassword(keeper.token, {
        currentPassword: 'Wr0ngCurrentPass',
        newPassword: 'N3verAppliedPass',
      }).expect(403);

      expect((response.body as { message: string }).message).toBe(
        WRONG_CURRENT_PASSWORD_MESSAGE,
      );

      // The stored password is untouched: the original still logs in, and the
      // one that was offered as a replacement never took effect.
      await login(keeper.email, STRONG_PASSWORD).expect(200);

      // And the caller's own session is still a session — a mistyped current
      // password is not a sign-out (D-11).
      expect((await getProfile(keeper.token)).email).toBe(keeper.email);
    }, 20_000);

    describe('a new password breaking the registration rules (AC-12)', () => {
      it('names the length rule when it is shorter than 8 characters', async () => {
        const response = await changePassword(keeper.token, {
          currentPassword: STRONG_PASSWORD,
          newPassword: 'Ab1cdef',
        }).expect(400);

        expect(JSON.stringify(response.body)).toContain(
          'at least 8 characters',
        );
      });

      it('names the complexity rule when it carries no uppercase letter', async () => {
        const response = await changePassword(keeper.token, {
          currentPassword: STRONG_PASSWORD,
          newPassword: 'nouppercase1',
        }).expect(400);

        expect(JSON.stringify(response.body)).toContain(
          'must contain an uppercase letter, a lowercase letter, and a digit',
        );
      });

      it('names the complexity rule when it carries no digit', async () => {
        const response = await changePassword(keeper.token, {
          currentPassword: STRONG_PASSWORD,
          newPassword: 'NoDigitsHere',
        }).expect(400);

        expect(JSON.stringify(response.body)).toContain(
          'must contain an uppercase letter, a lowercase letter, and a digit',
        );
      });

      it('names the 72-character cap when it is longer than bcrypt reads', async () => {
        const response = await changePassword(keeper.token, {
          currentPassword: STRONG_PASSWORD,
          newPassword: `A1${'b'.repeat(71)}`,
        }).expect(400);

        expect(JSON.stringify(response.body)).toContain('72 characters');
      });

      it('refuses a missing current password before it checks anything else', async () => {
        await changePassword(keeper.token, {
          newPassword: 'N3verAppliedPass',
        }).expect(400);

        await changePassword(keeper.token, {
          currentPassword: '',
          newPassword: 'N3verAppliedPass',
        }).expect(400);
      });

      it('leaves the stored password exactly as it was through all of them', async () => {
        await login(keeper.email, STRONG_PASSWORD).expect(200);
      }, 20_000);
    });

    it("takes its subject from the token, never from the body — B's change cannot reach A (AC-15)", async () => {
      const keeperProfile = await getProfile(keeper.token);
      const impostorNewPassword = 'Imp0storsOwnPass';

      await changePassword(impostor.token, {
        currentPassword: STRONG_PASSWORD,
        newPassword: impostorNewPassword,
        userId: keeperProfile.id,
        id: keeperProfile.id,
        email: keeper.email,
      }).expect(200);

      // The impostor changed its own credential...
      await login(impostor.email, impostorNewPassword).expect(200);

      // ...and the account it named is untouched: same password, live session.
      await login(keeper.email, STRONG_PASSWORD).expect(200);
      expect((await getProfile(keeper.token)).id).toBe(keeperProfile.id);
    }, 20_000);

    it(`answers 429 on the ${PASSWORD_ROUTE_LIMIT + 1}th wrong guess inside the window (AC-20, S-4)`, async () => {
      for (let attempt = 1; attempt <= PASSWORD_ROUTE_LIMIT; attempt += 1) {
        await changePassword(hammer.token, {
          currentPassword: `Wr0ngGuess${attempt}`,
          newPassword: 'N3verAppliedPass',
        }).expect(403);
      }

      await changePassword(hammer.token, {
        currentPassword: `Wr0ngGuess${PASSWORD_ROUTE_LIMIT + 1}`,
        newPassword: 'N3verAppliedPass',
      }).expect(429);

      // The refusal is the answer, not a slower version of the check: the
      // account's own password is still what it was.
      await login(hammer.email, STRONG_PASSWORD).expect(200);
    }, 60_000);
  });
});
