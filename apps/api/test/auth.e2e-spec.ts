import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

const STRONG_PASSWORD = 'Str0ngPass!';

interface AuthResponseBody {
  accessToken: string;
}

/**
 * Builds a fresh, never-before-registered email so registration tests don't
 * collide with each other or with previous runs against the same database.
 * @returns A unique email address.
 */
function uniqueEmail(): string {
  return `auth-e2e-${randomUUID()}@example.com`;
}

describe('Auth (e2e)', () => {
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

  describe('POST /auth/register', () => {
    it('creates a new user and returns a JWT for a valid payload', async () => {
      const email = uniqueEmail();

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: STRONG_PASSWORD, consentToTerms: true })
        .expect(201);

      const body = response.body as AuthResponseBody;
      expect(body).toHaveProperty('accessToken');
      expect(typeof body.accessToken).toBe('string');
      expect(body.accessToken.split('.')).toHaveLength(3);
      expect(body).not.toHaveProperty('password');
      expect(body).not.toHaveProperty('passwordHash');
    });

    it('rejects a second registration with the same email', async () => {
      const email = uniqueEmail();

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: STRONG_PASSWORD, consentToTerms: true })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: STRONG_PASSWORD, consentToTerms: true })
        .expect(409);
    });

    it('rejects an invalid email format', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'not-an-email',
          password: STRONG_PASSWORD,
          consentToTerms: true,
        })
        .expect(400);
    });

    it('rejects a password shorter than 8 characters', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: uniqueEmail(),
          password: 'Ab1defg',
          consentToTerms: true,
        })
        .expect(400);
    });

    it('rejects a password with no uppercase letter', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: uniqueEmail(),
          password: 'weakpass1',
          consentToTerms: true,
        })
        .expect(400);
    });

    it('rejects a password with no lowercase letter', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: uniqueEmail(),
          password: 'WEAKPASS1',
          consentToTerms: true,
        })
        .expect(400);
    });

    it('rejects a password with no digit', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: uniqueEmail(),
          password: 'WeakPassword',
          consentToTerms: true,
        })
        .expect(400);
    });

    it('rejects registration when consentToTerms is false', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: uniqueEmail(),
          password: STRONG_PASSWORD,
          consentToTerms: false,
        })
        .expect(400);
    });

    it('rejects registration when consentToTerms is missing', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: uniqueEmail(), password: STRONG_PASSWORD })
        .expect(400);
    });
  });

  describe('POST /auth/login', () => {
    it('logs a registered user in and returns a JWT', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: STRONG_PASSWORD, consentToTerms: true })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: STRONG_PASSWORD })
        .expect(200);

      const body = response.body as AuthResponseBody;
      expect(body).toHaveProperty('accessToken');
      expect(typeof body.accessToken).toBe('string');
      expect(body.accessToken.split('.')).toHaveLength(3);
    });

    it('rejects an incorrect password', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: STRONG_PASSWORD, consentToTerms: true })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'WrongPass1' })
        .expect(401);
    });

    it('rejects a login for an email that was never registered', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: uniqueEmail(), password: STRONG_PASSWORD })
        .expect(401);
    });

    it('rejects an invalid email format', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'not-an-email', password: STRONG_PASSWORD })
        .expect(400);
    });

    it('rejects a login request with no password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: uniqueEmail() })
        .expect(400);
    });
  });
});
