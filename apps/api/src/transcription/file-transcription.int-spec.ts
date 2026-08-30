import { randomUUID } from 'crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';

const PASSWORD_HASH =
  '$2b$10$abcdefghijklmnopqrstuvwxyz012345678901234567890123';

/** Longest `failureReason` the column accepts, matching `@db.VarChar(200)` (D-4). */
const MAX_FAILURE_REASON_LENGTH = 200;

/** Longest `detectedLanguage` the column accepts, matching `@db.VarChar(64)` (D-4). */
const MAX_DETECTED_LANGUAGE_LENGTH = 64;

/** The table the model maps onto, and the name the index cases look for. */
const TABLE_NAME = 'file_transcriptions';

/** The four states a run can be in, in the order the enum declares them (D-4). */
const RUN_STATES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'];

/** Every column D-4 puts on a run, as a case reads one back. */
interface FileTranscriptionRow {
  id: string;
  fileId: string;
  state: string;
  text: string | null;
  failureReason: string | null;
  engine: string;
  model: string;
  effort: string;
  languageMode: string;
  detectedLanguage: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** What a case writes when it records a run. */
interface FileTranscriptionInput {
  fileId: string;
  state: string;
  text?: string | null;
  failureReason?: string | null;
  engine: string;
  model: string;
  effort: string;
  languageMode: string;
  detectedLanguage?: string | null;
  startedAt?: Date | null;
  endedAt?: Date | null;
}

/** The subset of Prisma's `fileTranscription` delegate these cases use. */
interface FileTranscriptionDelegate {
  create(args: { data: FileTranscriptionInput }): Promise<FileTranscriptionRow>;
  findUnique(args: {
    where: { fileId: string };
  }): Promise<FileTranscriptionRow | null>;
  update(args: {
    where: { fileId: string };
    data: Partial<FileTranscriptionInput>;
  }): Promise<FileTranscriptionRow>;
}

/**
 * Reaches the run table through a narrowed delegate, the shape
 * `transcription.int-spec.ts` set while the migration was still ahead of it.
 * @param prisma - The connected Prisma service.
 * @returns The `fileTranscription` delegate, narrowed to what is used here.
 */
function transcriptionRows(prisma: PrismaService): FileTranscriptionDelegate {
  return (prisma as unknown as { fileTranscription: FileTranscriptionDelegate })
    .fileTranscription;
}

/**
 * A run as a case records one, with only the field under test varied.
 * @param fileId - The file the run belongs to.
 * @param overrides - The fields this case cares about.
 * @returns The row to create.
 */
function runFor(
  fileId: string,
  overrides: Partial<FileTranscriptionInput> = {},
): FileTranscriptionInput {
  return {
    fileId,
    state: 'QUEUED',
    engine: 'local',
    model: 'tiny',
    effort: 'low',
    languageMode: 'auto',
    ...overrides,
  };
}

describe('FileTranscription schema (integration)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  const createdUserIds: string[] = [];
  const createdMeetingIds: string[] = [];
  const createdFileIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        // Same env wiring as AppModule: apps/api runs with cwd=apps/api and
        // the repo keeps a single .env two levels up.
        ConfigModule.forRoot({ isGlobal: true, envFilePath: '../../.env' }),
        PrismaModule,
      ],
    }).compile();

    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    if (createdFileIds.length > 0) {
      // The runs go with their files, which is the cascade under test.
      await prisma.meetingFile.deleteMany({
        where: { id: { in: createdFileIds } },
      });
    }
    if (createdMeetingIds.length > 0) {
      await prisma.meeting.deleteMany({
        where: { id: { in: createdMeetingIds } },
      });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await moduleRef.close();
  });

  /**
   * Creates an owner, a meeting and a stored file of their own, so nothing a
   * case writes can be reached by another case.
   * @returns The created file's id.
   */
  async function createStoredFile(): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: `file-transcription-int-${randomUUID()}@example.com`,
        passwordHash: PASSWORD_HASH,
        consentToTerms: true,
      },
    });
    createdUserIds.push(user.id);

    const meeting = await prisma.meeting.create({
      data: {
        title: 'FileTranscription schema',
        date: new Date(),
        participants: [],
        ownerId: user.id,
      },
    });
    createdMeetingIds.push(meeting.id);

    const file = await prisma.meetingFile.create({
      data: {
        meetingId: meeting.id,
        name: 'recording.mp3',
        size: 1024,
        mimeType: 'audio/mpeg',
        storageKey: `meetings/${meeting.id}/${randomUUID()}`,
      },
    });
    createdFileIds.push(file.id);

    return file.id;
  }

  it('stores a run with every column the transcript needs, and reads it back', async () => {
    const fileId = await createStoredFile();
    const startedAt = new Date();
    const endedAt = new Date(startedAt.getTime() + 1_000);

    const created = await transcriptionRows(prisma).create({
      data: runFor(fileId, {
        state: 'SUCCEEDED',
        text: 'the words that were spoken',
        detectedLanguage: 'ru',
        startedAt,
        endedAt,
      }),
    });

    const stored = await transcriptionRows(prisma).findUnique({
      where: { fileId },
    });

    expect(created.id).toEqual(expect.any(String));
    expect(stored).not.toBeNull();
    expect(stored).toMatchObject({
      fileId,
      state: 'SUCCEEDED',
      text: 'the words that were spoken',
      failureReason: null,
      engine: 'local',
      model: 'tiny',
      effort: 'low',
      languageMode: 'auto',
      detectedLanguage: 'ru',
    });
    expect(stored?.startedAt?.getTime()).toBe(startedAt.getTime());
    expect(stored?.endedAt?.getTime()).toBe(endedAt.getTime());
    expect(stored?.queuedAt).toBeInstanceOf(Date);
    expect(stored?.createdAt).toBeInstanceOf(Date);
    expect(stored?.updatedAt).toBeInstanceOf(Date);
  });

  it('leaves a queued run without a transcript, a language or an ending', async () => {
    const fileId = await createStoredFile();

    const created = await transcriptionRows(prisma).create({
      data: runFor(fileId),
    });

    expect(created).toMatchObject({
      state: 'QUEUED',
      text: null,
      failureReason: null,
      detectedLanguage: null,
      startedAt: null,
      endedAt: null,
    });
    expect(created.queuedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it.each(RUN_STATES)('accepts the state %s', async (state) => {
    const fileId = await createStoredFile();

    const created = await transcriptionRows(prisma).create({
      data: runFor(fileId, { state }),
    });

    expect(created.state).toBe(state);
  });

  it('refuses a state the enum does not declare', async () => {
    const fileId = await createStoredFile();

    await expect(
      transcriptionRows(prisma).create({
        data: runFor(fileId, { state: 'CANCELLED' }),
      }),
    ).rejects.toThrow();
  });

  it('holds one run per file, so a second row for the same file is refused', async () => {
    const fileId = await createStoredFile();
    await transcriptionRows(prisma).create({ data: runFor(fileId) });

    await expect(
      transcriptionRows(prisma).create({ data: runFor(fileId) }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('refuses a run for a file that does not exist', async () => {
    await expect(
      transcriptionRows(prisma).create({ data: runFor(randomUUID()) }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('lets the purge delete the file and takes the run with it (AC-10)', async () => {
    const fileId = await createStoredFile();
    await transcriptionRows(prisma).create({
      data: runFor(fileId, { state: 'SUCCEEDED', text: 'the meeting' }),
    });

    // What FilesPurgeService.purgeExpired() does per expired file: an
    // onDelete: Restrict relation would make this throw (D-4).
    await expect(
      prisma.meetingFile.delete({ where: { id: fileId } }),
    ).resolves.toMatchObject({ id: fileId });

    await expect(
      transcriptionRows(prisma).findUnique({ where: { fileId } }),
    ).resolves.toBeNull();
  });

  it('caps a failure reason at the length a fixed message needs (S-3)', async () => {
    const fileId = await createStoredFile();

    const accepted = await transcriptionRows(prisma).create({
      data: runFor(fileId, {
        state: 'FAILED',
        failureReason: 'r'.repeat(MAX_FAILURE_REASON_LENGTH),
      }),
    });
    expect(accepted.failureReason).toHaveLength(MAX_FAILURE_REASON_LENGTH);

    const otherFileId = await createStoredFile();
    await expect(
      transcriptionRows(prisma).create({
        data: runFor(otherFileId, {
          state: 'FAILED',
          failureReason: 'r'.repeat(MAX_FAILURE_REASON_LENGTH + 1),
        }),
      }),
    ).rejects.toThrow();
  });

  it('caps the detected language at the length the engine may name (S-3)', async () => {
    const fileId = await createStoredFile();

    const accepted = await transcriptionRows(prisma).create({
      data: runFor(fileId, {
        state: 'SUCCEEDED',
        detectedLanguage: 'l'.repeat(MAX_DETECTED_LANGUAGE_LENGTH),
      }),
    });
    expect(accepted.detectedLanguage).toHaveLength(
      MAX_DETECTED_LANGUAGE_LENGTH,
    );

    const otherFileId = await createStoredFile();
    await expect(
      transcriptionRows(prisma).create({
        data: runFor(otherFileId, {
          state: 'SUCCEEDED',
          detectedLanguage: 'l'.repeat(MAX_DETECTED_LANGUAGE_LENGTH + 1),
        }),
      }),
    ).rejects.toThrow();
  });

  it('keeps the previous transcript under a run that is started again (AC-9)', async () => {
    const fileId = await createStoredFile();
    await transcriptionRows(prisma).create({
      data: runFor(fileId, {
        state: 'SUCCEEDED',
        text: 'the first transcript',
        detectedLanguage: 'en',
        startedAt: new Date(),
        endedAt: new Date(),
      }),
    });

    const restarted = await transcriptionRows(prisma).update({
      where: { fileId },
      data: {
        state: 'QUEUED',
        failureReason: null,
        startedAt: null,
        endedAt: null,
      },
    });

    expect(restarted).toMatchObject({
      state: 'QUEUED',
      text: 'the first transcript',
      startedAt: null,
      endedAt: null,
    });
  });

  it('indexes the runs a sweep looks for, on the table D-4 maps them to', async () => {
    const indexes = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE tablename = ${TABLE_NAME}
    `;
    const definitions = indexes.map((index) => index.indexdef);

    expect(definitions).toContainEqual(
      expect.stringMatching(/\(state, "?queuedAt"?\)/),
    );
    expect(definitions).toContainEqual(
      expect.stringMatching(/UNIQUE.*\("?fileId"?\)/),
    );
  });
});
