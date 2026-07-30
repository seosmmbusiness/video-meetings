import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

const STRONG_PASSWORD = 'Str0ngPass!';

interface MeetingResponseBody {
  id: string;
  title: string;
  description: string | null;
  date: string;
  participants: string[];
  ownerId: string;
}

/**
 * Builds a fresh, never-before-registered email so registration doesn't
 * collide across tests or previous runs against the same database.
 * @returns A unique email address.
 */
function uniqueEmail(): string {
  return `meetings-e2e-${randomUUID()}@example.com`;
}

/**
 * Builds a syntactically valid create-meeting payload, overridable per test.
 * @param overrides - Partial fields to override on the default payload.
 * @returns A create-meeting request body.
 */
function meetingPayload(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Sprint planning',
    description: 'Plan the next sprint',
    date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    participants: ['alice@example.com', 'bob@example.com'],
    ...overrides,
  };
}

describe('Meetings (e2e)', () => {
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

  describe('POST /meetings', () => {
    it('creates a new meeting for the authenticated user', async () => {
      const token = await registerUser();
      const payload = meetingPayload();

      const response = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(201);

      const body = response.body as MeetingResponseBody;
      expect(body).toHaveProperty('id');
      expect(body.title).toBe(payload.title);
      expect(body.description).toBe(payload.description);
      expect(new Date(body.date).toISOString()).toBe(payload.date);
      expect(body.participants).toEqual(payload.participants);
      expect(body).toHaveProperty('ownerId');
    });

    it('creates a meeting without a description (optional field)', async () => {
      const token = await registerUser();
      const payload = meetingPayload();
      delete (payload as { description?: string }).description;

      const response = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(201);

      const body = response.body as MeetingResponseBody;
      expect(body.description == null).toBe(true);
    });

    it('rejects the request when no auth token is provided', async () => {
      await request(app.getHttpServer())
        .post('/meetings')
        .send(meetingPayload())
        .expect(401);
    });

    it('rejects the request with an invalid auth token', async () => {
      await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', 'Bearer not-a-real-token')
        .send(meetingPayload())
        .expect(401);
    });

    it('rejects a missing title', async () => {
      const token = await registerUser();
      const payload = meetingPayload();
      delete (payload as { title?: string }).title;

      await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(400);
    });

    it('rejects an empty title', async () => {
      const token = await registerUser();

      await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send(meetingPayload({ title: '' }))
        .expect(400);
    });

    it('rejects a missing date', async () => {
      const token = await registerUser();
      const payload = meetingPayload();
      delete (payload as { date?: string }).date;

      await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(400);
    });

    it('rejects an invalid date format', async () => {
      const token = await registerUser();

      await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send(meetingPayload({ date: 'not-a-date' }))
        .expect(400);
    });

    it('rejects a missing participants field', async () => {
      const token = await registerUser();
      const payload = meetingPayload();
      delete (payload as { participants?: string[] }).participants;

      await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(400);
    });

    it('rejects participants that is not an array', async () => {
      const token = await registerUser();

      await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send(meetingPayload({ participants: 'alice@example.com' }))
        .expect(400);
    });

    it('rejects a participants array containing an invalid email', async () => {
      const token = await registerUser();

      await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send(meetingPayload({ participants: ['not-an-email'] }))
        .expect(400);
    });
  });

  describe('GET /meetings', () => {
    it('rejects the request when no auth token is provided', async () => {
      await request(app.getHttpServer()).get('/meetings').expect(401);
    });

    it('returns an empty array for a user with no meetings', async () => {
      const token = await registerUser();

      const response = await request(app.getHttpServer())
        .get('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it("returns only the authenticated user's meetings", async () => {
      const tokenA = await registerUser();
      const tokenB = await registerUser();

      const createdA = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(meetingPayload({ title: 'Owned by A' }))
        .expect(201);

      await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${tokenB}`)
        .send(meetingPayload({ title: 'Owned by B' }))
        .expect(201);

      const response = await request(app.getHttpServer())
        .get('/meetings')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const meetings = response.body as MeetingResponseBody[];
      expect(meetings).toHaveLength(1);
      expect(meetings[0].id).toBe((createdA.body as MeetingResponseBody).id);
      expect(meetings[0].title).toBe('Owned by A');
    });
  });

  describe('GET /meetings/:id', () => {
    it('rejects the request when no auth token is provided', async () => {
      await request(app.getHttpServer())
        .get(`/meetings/${randomUUID()}`)
        .expect(401);
    });

    it('returns the meeting when it exists and belongs to the user', async () => {
      const token = await registerUser();
      const payload = meetingPayload();

      const created = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(201);

      const { id } = created.body as MeetingResponseBody;

      const response = await request(app.getHttpServer())
        .get(`/meetings/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as MeetingResponseBody;
      expect(body.id).toBe(id);
      expect(body.title).toBe(payload.title);
      expect(body.participants).toEqual(payload.participants);
    });

    it('returns 404 for a meeting id that does not exist', async () => {
      const token = await registerUser();

      await request(app.getHttpServer())
        .get(`/meetings/${randomUUID()}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 404 for a meeting that belongs to another user', async () => {
      const tokenA = await registerUser();
      const tokenB = await registerUser();

      const created = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(meetingPayload())
        .expect(201);

      const { id } = created.body as MeetingResponseBody;

      await request(app.getHttpServer())
        .get(`/meetings/${id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
    });
  });
});
