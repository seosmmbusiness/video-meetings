import { randomUUID } from 'crypto';
import { readdir } from 'fs/promises';
import * as http from 'http';
import { sign } from 'jsonwebtoken';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { resolveStorageRoot } from '../src/files/storage/storage-root';
import { PrismaService } from '../src/prisma/prisma.service';

const STRONG_PASSWORD = 'Str0ngPass!';

/**
 * A minimal but structurally valid PNG: the 8-byte signature, a well-formed
 * 13-byte `IHDR` chunk (file-type's PNG scanner parses the chunk length
 * before it will report a match) and an empty `IDAT` chunk.
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
 * `GIF89a` signature bytes — a real, content-detectable format that isn't
 * one of the twelve this feature accepts, used to prove AC-6's "renamed
 * extension" clause without relying on the ambiguous PNG example in the
 * plan (PNG is itself accepted, so it cannot be the refused case).
 * @returns The GIF byte sequence.
 */
function gifBytes(): Buffer {
  return Buffer.concat([Buffer.from('GIF89a'), Buffer.from([0x01, 0x02])]);
}

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
  /** Real TCP port the app is bound to — needed for the raw-socket cases (S-9, 2.5) that control body timing beyond what supertest exposes. */
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

  /**
   * The multipart header for a single-file upload, up to (but not
   * including) the file's own bytes — split out so a raw-socket case can
   * send it alone and then go quiet, or pace the bytes that follow.
   * @param boundary - The multipart boundary string.
   * @param filename - The file name to declare in the part header.
   * @returns The header bytes.
   */
  function multipartHeader(boundary: string, filename: string): Buffer {
    return Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    );
  }

  /**
   * The multipart closing boundary that must follow a part's bytes.
   * @param boundary - The multipart boundary string.
   * @returns The footer bytes.
   */
  function multipartFooter(boundary: string): Buffer {
    return Buffer.from(`\r\n--${boundary}--\r\n`);
  }

  /**
   * Opens a raw upload request against the app's real listening port,
   * bypassing supertest so the caller can control exactly when bytes are
   * written and when the connection ends.
   * @param meetingIdParam - Target meeting id.
   * @param token - The caller's access token.
   * @param boundary - The multipart boundary to declare in `Content-Type`.
   * @param contentLength - The declared `Content-Length` header value.
   * @returns The open client request.
   */
  function openRawUpload(
    meetingIdParam: string,
    token: string,
    boundary: string,
    contentLength: number,
  ): http.ClientRequest {
    return http.request({
      host: '127.0.0.1',
      port,
      path: `/meetings/${meetingIdParam}/files`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': contentLength,
      },
    });
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
        '../../etc/passwd.txt',
      );

      expect(body.name).toBe('passwd.txt');
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

    it('rejects the request with a malformed auth token', async () => {
      await request(app.getHttpServer())
        .get(`/meetings/${randomUUID()}/files`)
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);
    });

    it('rejects the request with an expired auth token', async () => {
      await request(app.getHttpServer())
        .get(`/meetings/${randomUUID()}/files`)
        .set('Authorization', `Bearer ${expiredToken()}`)
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
      // A real accepted binary type (rather than arbitrary text), so the
      // download response's Content-Type stays a superagent-buffered binary
      // type and Buffer.compare below is actually exercising byte-for-byte
      // identity, not a text-decoded round trip.
      bytes = pngBytes();
      const uploaded = await uploadFile(
        ownerToken,
        meetingId,
        bytes,
        'fixture.png',
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
      const fileB = await uploadFile(tokenB, meetingB, pngBytes(), 'b.png');

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

  describe('POST /meetings/:meetingId/files — size limit (2.1, AC-5)', () => {
    let ownerToken: string;
    let meetingId: string;

    beforeAll(async () => {
      ownerToken = await registerUser();
      meetingId = await createMeeting(ownerToken);
    });

    it('refuses a declared size over 500 MB with 413 at zero bytes read, leaving tmp empty', async () => {
      const boundary = `----size${randomUUID()}`;
      const declaredLength = 524_288_000 + 1024;

      const { statusCode, body } = await new Promise<{
        statusCode: number;
        body: string;
      }>((resolve, reject) => {
        const req = openRawUpload(
          meetingId,
          ownerToken,
          boundary,
          declaredLength,
        );
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
        // The guard refuses on the declared Content-Length alone, before a
        // single body byte is read — this request never actually sends the
        // 500 MB it declares.
        req.end();
      });

      expect(statusCode).toBe(413);
      expect((JSON.parse(body) as { message: string }).message).toBe(
        'File exceeds the 500 MB per-file limit.',
      );

      const tempDir = `${resolveStorageRoot()}/tmp`;
      const leftover = (await readdir(tempDir)).filter(
        (name) => name !== '.gitkeep',
      );
      expect(leftover).toEqual([]);
    });
  });

  describe('POST /meetings/:meetingId/files — file type (2.2, AC-6)', () => {
    let ownerToken: string;
    let meetingId: string;

    beforeAll(async () => {
      ownerToken = await registerUser();
      meetingId = await createMeeting(ownerToken);
    });

    it('accepts a file by its detected content, regardless of extension', async () => {
      const body = await uploadFile(
        ownerToken,
        meetingId,
        pngBytes(),
        'photo.png',
      );
      expect(body.mimeType).toBe('image/png');
    });

    it('accepts a .txt file whose content is clean UTF-8 text', async () => {
      const body = await uploadFile(
        ownerToken,
        meetingId,
        Buffer.from('plain ascii notes, nothing binary here'),
        'notes.txt',
      );
      expect(body.mimeType).toBe('text/plain');
    });

    it(
      'rejects a detectable type outside the accepted list, naming the ' +
        'accepted types, even under a renamed (accepted-looking) extension ' +
        '(AC-6)',
      async () => {
        const response = await request(app.getHttpServer())
          .post(`/meetings/${meetingId}/files`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .attach('file', gifBytes(), 'not-really.pdf')
          .expect(415);

        expect((response.body as { message: string }).message).toBe(
          'Unsupported file type. Accepted types: mp4, webm, mov, mp3, wav, m4a, pdf, docx, txt, md, png, jpg.',
        );

        const list = await request(app.getHttpServer())
          .get(`/meetings/${meetingId}/files`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200);
        const names = (list.body as MeetingFileResponseBody[]).map(
          (f) => f.name,
        );
        expect(names).not.toContain('not-really.pdf');
      },
    );

    it('rejects a NUL-bearing blob named .txt, nothing stored', async () => {
      const response = await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('file', Buffer.from([0x68, 0x69, 0x00, 0x68, 0x69]), 'bad.txt')
        .expect(415);

      expect((response.body as { message: string }).message).toBe(
        'Unsupported file type. Accepted types: mp4, webm, mov, mp3, wav, m4a, pdf, docx, txt, md, png, jpg.',
      );
    });
  });

  describe('POST /meetings/:meetingId/files — live file cap (2.3, AC-7)', () => {
    let ownerToken: string;
    let meetingId: string;

    beforeAll(async () => {
      ownerToken = await registerUser();
      meetingId = await createMeeting(ownerToken);
      for (let i = 0; i < 20; i += 1) {
        await uploadFile(
          ownerToken,
          meetingId,
          Buffer.from(`file number ${i}`),
          `f${i}.txt`,
        );
      }
    });

    it('refuses the 21st live file with 409', async () => {
      const response = await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('file', Buffer.from('one too many'), 'f21.txt')
        .expect(409);

      expect((response.body as { message: string }).message).toBe(
        'This meeting already holds 20 files. Delete one to upload another.',
      );
    });

    it('lets the identical upload through immediately after a slot frees up', async () => {
      const list = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const [victim] = list.body as MeetingFileResponseBody[];

      // Phase 3 owns the real DELETE route; a direct soft-delete here
      // exercises exactly what task 2.3's live-file count already filters
      // on (`deletedAt: null`) without depending on unbuilt work.
      const prisma = app.get(PrismaService);
      await prisma.meetingFile.update({
        where: { id: victim.id },
        data: { deletedAt: new Date() },
      });

      const body = await uploadFile(
        ownerToken,
        meetingId,
        Buffer.from('the freed slot'),
        'f21.txt',
      );
      expect(body.name).toBe('f21.txt');
    });
  });

  describe('POST /meetings/:meetingId/files — owner quota (2.4, AC-8, S-3)', () => {
    let ownerToken: string;
    let meetingId: string;

    beforeAll(async () => {
      ownerToken = await registerUser();
      meetingId = await createMeeting(ownerToken);
    });

    /**
     * Replaces the owner's single seed row (metadata only — no bytes on
     * disk, which is fine: only `size` feeds the quota sum) with one
     * leaving exactly `remainingBytes` of headroom under the 20 GB ceiling.
     * @param remainingBytes - Space to leave before the ceiling.
     */
    async function seedUsedSpace(remainingBytes: number): Promise<void> {
      const prisma = app.get(PrismaService);
      await prisma.meetingFile.deleteMany({ where: { meetingId } });

      // `size` is a 32-bit `Int` column (a single file tops out at 500 MB,
      // which fits) — the ~20 GB target only fits once split across several
      // rows, exactly as production reaches it (Postgres widens `SUM(int)`
      // to `bigint`; a single row this large would overflow the column).
      // Soft-deleted (AC-8: deleted-but-not-purged bytes still count against
      // the owner's quota) so these seed rows don't also trip the 20-live-
      // file cap (2.3) the quota checks below aren't exercising.
      let remainingToSeed = 21_474_836_480 - remainingBytes;
      const rows: {
        id: string;
        meetingId: string;
        name: string;
        size: number;
        mimeType: string;
        storageKey: string;
        deletedAt: Date;
      }[] = [];
      while (remainingToSeed > 0) {
        const size = Math.min(remainingToSeed, 524_288_000);
        rows.push({
          id: randomUUID(),
          meetingId,
          name: 'seed.bin',
          size,
          mimeType: 'application/octet-stream',
          storageKey: `meetings/${meetingId}/${randomUUID()}`,
          deletedAt: new Date(),
        });
        remainingToSeed -= size;
      }
      await prisma.meetingFile.createMany({ data: rows });
    }

    it('refuses an over-quota upload with 507 naming the space left', async () => {
      await seedUsedSpace(1_000);

      const response = await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('file', Buffer.from('x'.repeat(5_000)), 'over.txt')
        .expect(507);

      const message = (response.body as { message: string }).message;
      expect(message).toContain('Not enough space:');
      expect(message).toContain('of the 20 GB total remains.');
    });

    it('refuses the later of two concurrent uploads that together cross the ceiling, leaving the first to succeed (S-3)', async () => {
      await seedUsedSpace(5_000_000);
      const payload = Buffer.from('y'.repeat(4_000_000));

      const rawResults = await Promise.all([
        request(app.getHttpServer())
          .post(`/meetings/${meetingId}/files`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .attach('file', payload, 'concurrent-a.txt'),
        request(app.getHttpServer())
          .post(`/meetings/${meetingId}/files`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .attach('file', payload, 'concurrent-b.txt'),
      ]);

      const fulfilled = rawResults.filter((r) => r.status === 201);
      const rejected = rawResults.filter((r) => r.status === 507);
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const list = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const concurrentUploads = (list.body as MeetingFileResponseBody[]).filter(
        (f) => f.name.startsWith('concurrent-'),
      );
      expect(concurrentUploads).toHaveLength(1);
    });
  });

  describe('POST /meetings/:meetingId/files — broken uploads leave nothing (2.5, AC-9)', () => {
    let ownerToken: string;
    let meetingId: string;

    beforeAll(async () => {
      ownerToken = await registerUser();
      meetingId = await createMeeting(ownerToken);
    });

    it('leaves nothing stored and nothing counted when the connection is cut mid-body', async () => {
      const boundary = `----abort${randomUUID()}`;
      const header = multipartHeader(boundary, 'cut-short.bin');
      const fileBytes = Buffer.from('y'.repeat(50_000));
      const footer = multipartFooter(boundary);
      const fullLength = header.length + fileBytes.length + footer.length;

      await new Promise<void>((resolve) => {
        const req = openRawUpload(meetingId, ownerToken, boundary, fullLength);
        req.on('error', () => resolve());
        req.on('close', () => resolve());
        req.write(header);
        req.write(fileBytes.subarray(0, 1000));
        // Cut the connection instead of finishing the body — the
        // declared length is never reached.
        setTimeout(() => req.destroy(), 100);
      });

      // Give multer's own 'aborted' handler a tick to run its cleanup.
      await new Promise((resolve) => setTimeout(resolve, 200));

      const tempDir = `${resolveStorageRoot()}/tmp`;
      const leftover = (await readdir(tempDir)).filter(
        (name) => name !== '.gitkeep',
      );
      expect(leftover).toEqual([]);

      const list = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const names = (list.body as MeetingFileResponseBody[]).map((f) => f.name);
      expect(names).not.toContain('cut-short.bin');
    });
  });

  describe('POST /meetings/:meetingId/files — idle timeout (S-9)', () => {
    let ownerToken: string;
    let meetingId: string;

    beforeAll(async () => {
      ownerToken = await registerUser();
      meetingId = await createMeeting(ownerToken);
    });

    it('closes a connection that goes idle for longer than the timeout, storing nothing', async () => {
      const boundary = `----idle${randomUUID()}`;
      const header = multipartHeader(boundary, 'idle.bin');
      const fileBytes = Buffer.from('z'.repeat(1_000));
      const footer = multipartFooter(boundary);
      const fullLength = header.length + fileBytes.length + footer.length;

      const req = openRawUpload(meetingId, ownerToken, boundary, fullLength);
      const closed = new Promise<void>((resolve) => {
        req.on('close', () => resolve());
        req.on('error', () => resolve());
      });
      req.on('response', (res) => res.resume());

      const start = Date.now();
      // Send only the multipart header, then go silent — never writing
      // the file's own bytes or ending the request.
      req.write(header);
      await closed;
      const elapsedMs = Date.now() - start;

      // UPLOAD_IDLE_TIMEOUT_MS is 60_000; allow generous scheduling slack
      // in both directions rather than asserting an exact bound.
      expect(elapsedMs).toBeGreaterThanOrEqual(55_000);
      expect(elapsedMs).toBeLessThan(90_000);

      const list = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const names = (list.body as MeetingFileResponseBody[]).map((f) => f.name);
      expect(names).not.toContain('idle.bin');
    }, 90_000);

    it('still completes a transfer sent steadily, well inside the idle window', async () => {
      const boundary = `----steady${randomUUID()}`;
      const header = multipartHeader(boundary, 'steady.txt');
      const chunkA = Buffer.from('a'.repeat(1_000));
      const chunkB = Buffer.from('b'.repeat(1_000));
      const footer = multipartFooter(boundary);
      const fullLength =
        header.length + chunkA.length + chunkB.length + footer.length;

      const statusCode = await new Promise<number>((resolve, reject) => {
        const req = openRawUpload(meetingId, ownerToken, boundary, fullLength);
        req.on('error', reject);
        req.on('response', (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        });
        req.write(header);
        req.write(chunkA);
        setTimeout(() => {
          req.write(chunkB);
          req.end(footer);
        }, 5_000);
      });

      expect(statusCode).toBe(201);

      const list = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const names = (list.body as MeetingFileResponseBody[]).map((f) => f.name);
      expect(names).toContain('steady.txt');
    }, 30_000);
  });
});
