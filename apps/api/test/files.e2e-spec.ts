import { randomUUID } from 'crypto';
import { readdir } from 'fs/promises';
import { sign } from 'jsonwebtoken';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { resolveStorageRoot } from '../src/files/storage/storage-root';

const STRONG_PASSWORD = 'Str0ngPass!';

interface MeetingFileResponseBody {
  id: string;
  meetingId: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: string;
  deletedAt: string | null;
  purgeAt: string | null;
}

/**
 * Builds a fresh, never-before-registered email so registration doesn't
 * collide across tests or previous runs against the same database.
 * @returns A unique email address.
 */
function uniqueEmail(): string {
  return `files-e2e-${randomUUID()}@example.com`;
}

describe('Files (e2e)', () => {
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
   * Registers a brand-new user and returns their access token. Registration
   * shares the app-wide throttle bucket, so callers should reuse a token
   * across cases wherever the scenario allows it rather than registering
   * a fresh one per `it`.
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
   * Creates a meeting owned by the caller behind `token`.
   * @param token - The owner's access token.
   * @returns The created meeting's id.
   */
  async function createMeeting(token: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/meetings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Sprint planning',
        date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        participants: [],
      })
      .expect(201);

    return (response.body as { id: string }).id;
  }

  /**
   * Uploads `bytes` onto `meetingId` behind `token`.
   * @param token - The owner's access token.
   * @param meetingId - The target meeting's id.
   * @param bytes - The file content to upload.
   * @param name - The file name to send.
   * @returns The stored file's public DTO.
   */
  async function uploadFile(
    token: string,
    meetingId: string,
    bytes: Buffer,
    name: string,
  ): Promise<MeetingFileResponseBody> {
    const response = await request(app.getHttpServer())
      .post(`/meetings/${meetingId}/files`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', bytes, name)
      .expect(201);

    return response.body as MeetingFileResponseBody;
  }

  /**
   * Builds an already-expired access token signed with the same secret the
   * running app verifies against — no registration needed.
   * @returns An expired JWT.
   */
  function expiredToken(): string {
    return sign(
      { sub: randomUUID(), email: uniqueEmail() },
      process.env.JWT_SECRET ?? '',
      { expiresIn: -1 },
    );
  }

  describe('POST /meetings/:meetingId/files', () => {
    let ownerToken: string;
    let meetingId: string;
    let strangerToken: string;

    beforeAll(async () => {
      ownerToken = await registerUser();
      meetingId = await createMeeting(ownerToken);
      strangerToken = await registerUser();
    });

    it('stores an uploaded file and returns its metadata', async () => {
      const body = await uploadFile(
        ownerToken,
        meetingId,
        Buffer.from('hello world'),
        'notes.txt',
      );

      expect(body.meetingId).toBe(meetingId);
      expect(body.name).toBe('notes.txt');
      expect(body.size).toBe(Buffer.byteLength('hello world'));
      expect(body.deletedAt).toBeNull();
      expect(body.purgeAt).toBeNull();
    });

    it('rejects the request when no auth token is provided', async () => {
      await request(app.getHttpServer())
        .post(`/meetings/${randomUUID()}/files`)
        .attach('file', Buffer.from('hello'), 'a.txt')
        .expect(401);
    });

    it('rejects the request with a malformed auth token', async () => {
      await request(app.getHttpServer())
        .post(`/meetings/${randomUUID()}/files`)
        .set('Authorization', 'Bearer not-a-real-token')
        .attach('file', Buffer.from('hello'), 'a.txt')
        .expect(401);
    });

    it('rejects the request with an expired auth token', async () => {
      await request(app.getHttpServer())
        .post(`/meetings/${randomUUID()}/files`)
        .set('Authorization', `Bearer ${expiredToken()}`)
        .attach('file', Buffer.from('hello'), 'a.txt')
        .expect(401);
    });

    it("answers 404 for a meeting the caller doesn't own, leaving tmp empty (S-1)", async () => {
      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .attach('file', Buffer.from('should not land on disk'), 'a.txt')
        .expect(404);

      const tempDir = `${resolveStorageRoot()}/tmp`;
      const leftover = (await readdir(tempDir)).filter(
        (name) => name !== '.gitkeep',
      );
      expect(leftover).toEqual([]);
    });

    it('answers 404 for a meeting id that does not exist', async () => {
      await request(app.getHttpServer())
        .post(`/meetings/${randomUUID()}/files`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('file', Buffer.from('hello'), 'a.txt')
        .expect(404);
    });

    it('stores a traversal-shaped name as its basename (S-6, AC-18)', async () => {
      const body = await uploadFile(
        ownerToken,
        meetingId,
        Buffer.from('x'),
        '../../etc/passwd',
      );

      expect(body.name).toBe('passwd');
    });
  });

  describe('GET /meetings/:meetingId/files', () => {
    let ownerToken: string;
    let meetingId: string;
    let strangerToken: string;

    beforeAll(async () => {
      ownerToken = await registerUser();
      meetingId = await createMeeting(ownerToken);
      strangerToken = await registerUser();
      await uploadFile(
        ownerToken,
        meetingId,
        Buffer.from('hello world'),
        'notes.txt',
      );
    });

    it('rejects the request when no auth token is provided', async () => {
      await request(app.getHttpServer())
        .get(`/meetings/${randomUUID()}/files`)
        .expect(401);
    });

    it('lists only live files of a meeting the caller owns', async () => {
      const response = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const files = response.body as MeetingFileResponseBody[];
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('notes.txt');
    });

    it("answers 404 for a meeting the caller doesn't own", async () => {
      await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);
    });
  });

  describe('GET /meetings/:meetingId/files/:fileId/content', () => {
    let ownerToken: string;
    let meetingId: string;
    let fileId: string;
    let bytes: Buffer;
    let strangerToken: string;

    beforeAll(async () => {
      ownerToken = await registerUser();
      meetingId = await createMeeting(ownerToken);
      strangerToken = await registerUser();
      bytes = Buffer.from('the quick brown fox jumps over the lazy dog');
      const uploaded = await uploadFile(
        ownerToken,
        meetingId,
        bytes,
        'fixture.bin',
      );
      fileId = uploaded.id;
    });

    it('downloads bytes identical to what was uploaded', async () => {
      const response = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${fileId}/content`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(Buffer.compare(response.body as Buffer, bytes)).toBe(0);
    });

    it('sets a cache-control that is private and never public (S-7)', async () => {
      const response = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${fileId}/content`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const cacheControl = response.headers['cache-control'];
      expect(cacheControl).toContain('private');
      expect(cacheControl).not.toContain('public');
    });

    it('rejects the request when no auth token is provided', async () => {
      await request(app.getHttpServer())
        .get(`/meetings/${randomUUID()}/files/${randomUUID()}/content`)
        .expect(401);
    });

    it('rejects the request with a malformed auth token', async () => {
      await request(app.getHttpServer())
        .get(`/meetings/${randomUUID()}/files/${randomUUID()}/content`)
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);
    });

    it('rejects the request with an expired auth token', async () => {
      await request(app.getHttpServer())
        .get(`/meetings/${randomUUID()}/files/${randomUUID()}/content`)
        .set('Authorization', `Bearer ${expiredToken()}`)
        .expect(401);
    });

    it("answers 404 on the byte route for a file id from another owner's meeting, presented under a meeting the caller does own (S-2)", async () => {
      // ownerToken/meetingId/fileId is party A. Party B gets its own meeting and file.
      const tokenB = await registerUser();
      const meetingB = await createMeeting(tokenB);
      const fileB = await uploadFile(
        tokenB,
        meetingB,
        Buffer.from('b-owns-this'),
        'b.bin',
      );

      // A presents B's fileId under A's own meeting.
      await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${fileB.id}/content`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);

      // A's own file in that same meeting still reads back — not a blanket 404.
      const stillReadable = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${fileId}/content`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(Buffer.compare(stillReadable.body as Buffer, bytes)).toBe(0);
    });

    it("answers 404 for a meeting the caller doesn't own", async () => {
      await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${fileId}/content`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);
    });

    it('answers 404 for a file id that does not exist', async () => {
      await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${randomUUID()}/content`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });
  });
});
