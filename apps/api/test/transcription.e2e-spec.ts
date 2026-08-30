import { randomUUID } from 'crypto';
import { sign } from 'jsonwebtoken';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import {
  ENGLISH_SPEECH_FIXTURE,
  craftedExternalReferenceMovBytes,
  readSpeechFixture,
  readSpeechFixtureWords,
} from './fixtures/transcription-fixtures';

const STRONG_PASSWORD = 'Str0ngPass!';

/** How long a `tiny`-model run of the English fixture is given before the case fails. */
const RUN_TIMEOUT_MS = 180_000;

/** Gap between two polls of the per-file read route while a run is in flight. */
const POLL_INTERVAL_MS = 1_000;

interface MeetingFileResponseBody {
  id: string;
  name: string;
}

interface TranscriptionResponseBody {
  fileId: string;
  state: string;
  text: string | null;
  failureReason: string | null;
}

interface TranscriptionStateListBody {
  transcriptions: { fileId: string; state: string }[];
}

/**
 * Builds a fresh, never-before-registered email so registration doesn't
 * collide across tests or previous runs against the same database.
 * @returns A unique email address.
 */
function uniqueEmail(): string {
  return `transcription-e2e-${randomUUID()}@example.com`;
}

describe('Transcription (e2e)', () => {
  let app: INestApplication<App>;
  /** The owner every case acts as; registered once, since registration shares one throttle bucket. */
  let ownerToken: string;
  /** A second account, signed in and entitled to nothing of the owner's. */
  let strangerToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    ownerToken = await registerUser();
    strangerToken = await registerUser();
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
   * @param bytes - The recording's bytes.
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
   * Creates a meeting holding one recording the caller owns. Cases that are
   * about a refusal rather than about speech use the crafted container,
   * which is a real `video/quicktime` by content and needs no fixture on
   * the machine.
   * @param bytes - The recording's bytes.
   * @param name - The file name to store it under.
   * @returns The meeting and file ids.
   */
  async function meetingWithRecording(
    bytes: Buffer,
    name: string,
  ): Promise<{ meetingId: string; file: MeetingFileResponseBody }> {
    const meetingId = await createMeeting(ownerToken);
    const file = await uploadFile(ownerToken, meetingId, bytes, name);
    return { meetingId, file };
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
   * Reads a file's transcription until the run reaches a final state or the
   * budget runs out — phase 1 starts the run in the background, so the
   * finished text is only ever visible to a later request.
   * @param meetingId - The meeting the file belongs to.
   * @param fileId - The file being transcribed.
   * @returns The final read body.
   * @throws Error if no final state is reached inside {@link RUN_TIMEOUT_MS}.
   */
  async function awaitFinalState(
    meetingId: string,
    fileId: string,
  ): Promise<TranscriptionResponseBody> {
    const deadline = Date.now() + RUN_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const response = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${fileId}/transcription`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const body = response.body as TranscriptionResponseBody;
      if (body.state === 'SUCCEEDED' || body.state === 'FAILED') {
        return body;
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    throw new Error(
      `The run did not reach a final state within ${RUN_TIMEOUT_MS} ms`,
    );
  }

  describe('one recording, start to finished text', () => {
    it(
      'answers the words the recording is known to carry (AC-4)',
      async () => {
        const { meetingId, file } = await meetingWithRecording(
          readSpeechFixture(ENGLISH_SPEECH_FIXTURE),
          ENGLISH_SPEECH_FIXTURE,
        );

        await request(app.getHttpServer())
          .post(`/meetings/${meetingId}/files/${file.id}/transcription`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({})
          .expect(202);

        const final = await awaitFinalState(meetingId, file.id);

        expect(final.state).toBe('SUCCEEDED');
        expect(final.text).toEqual(expect.any(String));

        const text = (final.text ?? '').toLowerCase();
        // A fixed string, an empty transcript and the file's own name each
        // have to fail this case — that is what makes it evidence the
        // engine really ran on these bytes.
        expect(text.trim()).not.toBe('');
        expect(text).not.toContain(file.name.toLowerCase());
        for (const word of readSpeechFixtureWords(ENGLISH_SPEECH_FIXTURE)) {
          expect(text).toContain(word);
        }
      },
      RUN_TIMEOUT_MS + POLL_INTERVAL_MS * 10,
    );
  });

  describe('POST /meetings/:meetingId/files/:fileId/transcription', () => {
    let meetingId: string;
    let file: MeetingFileResponseBody;

    beforeAll(async () => {
      ({ meetingId, file } = await meetingWithRecording(
        craftedExternalReferenceMovBytes(),
        'sprint-review.mov',
      ));
    });

    it('answers 404 to another owner, exactly as for a file that never existed (AC-14, S-1)', async () => {
      const strangerOnOwnersFile = await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files/${file.id}/transcription`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({})
        .expect(404);

      const strangerOnUnknownIds = await request(app.getHttpServer())
        .post(`/meetings/${randomUUID()}/files/${randomUUID()}/transcription`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({})
        .expect(404);

      expect(strangerOnOwnersFile.body).toEqual(strangerOnUnknownIds.body);
    });

    it('answers 404 for a file id from outside the meeting it is presented under (AC-14)', async () => {
      const otherMeetingId = await createMeeting(ownerToken);

      const ownFileUnderAnotherMeeting = await request(app.getHttpServer())
        .post(`/meetings/${otherMeetingId}/files/${file.id}/transcription`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(404);

      const unknownFileUnderThatMeeting = await request(app.getHttpServer())
        .post(`/meetings/${otherMeetingId}/files/${randomUUID()}/transcription`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(404);

      expect(ownFileUnderAnotherMeeting.body).toEqual(
        unknownFileUnderThatMeeting.body,
      );
    });

    it('answers 401 without a token and with an expired one', async () => {
      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files/${file.id}/transcription`)
        .send({})
        .expect(401);

      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files/${file.id}/transcription`)
        .set('Authorization', `Bearer ${expiredToken()}`)
        .send({})
        .expect(401);
    });

    it('never lets the body decide the run — a submitted state or text is stripped, not stored (mass assignment)', async () => {
      const started = await meetingWithRecording(
        craftedExternalReferenceMovBytes(),
        'planning.mov',
      );

      await request(app.getHttpServer())
        .post(
          `/meetings/${started.meetingId}/files/${started.file.id}/transcription`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ state: 'SUCCEEDED', text: 'injected transcript' })
        // `ValidationPipe`'s `whitelist` strips what no DTO declares, the
        // same way `PATCH /profile` treats an unknown field, so the start
        // is accepted and the submitted values simply never reach the run.
        .expect(202);

      const read = await request(app.getHttpServer())
        .get(
          `/meetings/${started.meetingId}/files/${started.file.id}/transcription`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const body = read.body as TranscriptionResponseBody;
      expect(body.state).not.toBe('SUCCEEDED');
      expect(body.text).not.toBe('injected transcript');
    });
  });

  describe('GET /meetings/:meetingId/files/:fileId/transcription', () => {
    let meetingId: string;
    let file: MeetingFileResponseBody;

    beforeAll(async () => {
      ({ meetingId, file } = await meetingWithRecording(
        craftedExternalReferenceMovBytes(),
        'retro.mov',
      ));
    });

    it('answers 404 to another owner, exactly as for a file that never existed (AC-14, S-1)', async () => {
      const strangerOnOwnersFile = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${file.id}/transcription`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);

      const strangerOnUnknownIds = await request(app.getHttpServer())
        .get(`/meetings/${randomUUID()}/files/${randomUUID()}/transcription`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);

      expect(strangerOnOwnersFile.body).toEqual(strangerOnUnknownIds.body);
    });

    it('answers 401 without a token and with an expired one', async () => {
      await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${file.id}/transcription`)
        .expect(401);

      await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${file.id}/transcription`)
        .set('Authorization', `Bearer ${expiredToken()}`)
        .expect(401);
    });

    it("never puts the file's storage key on the wire", async () => {
      const response = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${file.id}/transcription`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body).not.toHaveProperty('storageKey');
      expect(JSON.stringify(response.body)).not.toContain('meetings/');
    });
  });

  describe('GET /meetings/:meetingId/transcriptions', () => {
    let meetingId: string;
    let file: MeetingFileResponseBody;

    beforeAll(async () => {
      ({ meetingId, file } = await meetingWithRecording(
        craftedExternalReferenceMovBytes(),
        'standup.mov',
      ));
    });

    it("answers the meeting's run states, and no transcript text (D-6)", async () => {
      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files/${file.id}/transcription`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(202);

      const response = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/transcriptions`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const body = response.body as TranscriptionStateListBody;
      const entry = body.transcriptions.find((row) => row.fileId === file.id);
      expect(entry).toBeDefined();
      expect(entry).not.toHaveProperty('text');
      expect(JSON.stringify(body)).not.toContain('storageKey');
    });

    it('answers 404 to another owner, exactly as for a meeting that never existed (AC-14, S-1)', async () => {
      const strangerOnOwnersMeeting = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/transcriptions`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);

      const strangerOnUnknownMeeting = await request(app.getHttpServer())
        .get(`/meetings/${randomUUID()}/transcriptions`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);

      expect(strangerOnOwnersMeeting.body).toEqual(
        strangerOnUnknownMeeting.body,
      );
    });

    it('answers 401 without a token', async () => {
      await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/transcriptions`)
        .expect(401);
    });
  });
});
