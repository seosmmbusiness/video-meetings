import { randomUUID } from 'crypto';
import dns from 'dns';
import * as net from 'net';
import tls from 'tls';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { NotFoundException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { FileStorage } from '../storage/file-storage';
import { resolveStorageRoot } from '../storage/storage-root';
import {
  CRAFTED_EXTERNAL_REFERENCE,
  RUSSIAN_SPEECH_FIXTURE,
  RUSSIAN_SPEECH_LANGUAGE,
  craftedExternalReferenceMovBytes,
  readSpeechFixture,
  readSpeechFixtureWords,
} from '../../test/fixtures/transcription-fixtures';
import { TranscriptionModule } from './transcription.module';
import { TranscriptionService } from './transcription.service';

const PASSWORD_HASH =
  '$2b$10$abcdefghijklmnopqrstuvwxyz012345678901234567890123';

/** How long a real `tiny`-model run is given before a case fails. */
const RUN_TIMEOUT_MS = 180_000;

/** Gap between two reads of the run's row while it is in flight. */
const POLL_INTERVAL_MS = 1_000;

/** Longest a `failureReason` may be, matching `@db.VarChar(200)` (research §5). */
const MAX_FAILURE_REASON_LENGTH = 200;

/** The run row as this phase's cases read it. */
interface FileTranscriptionRow {
  fileId: string;
  state: string;
  text: string | null;
  detectedLanguage: string | null;
  failureReason: string | null;
}

/** The subset of Prisma's `fileTranscription` delegate these cases use. */
interface FileTranscriptionDelegate {
  findUnique(args: {
    where: { fileId: string };
  }): Promise<FileTranscriptionRow | null>;
  deleteMany(args: {
    where: { fileId: { in: string[] } };
  }): Promise<{ count: number }>;
}

/** What a run answers the caller with, whichever way it ended. */
interface TranscriptionView {
  state: string;
  text: string | null;
}

/** The service surface phase 1 builds behind its three routes (1.2, 1.4). */
interface TranscriptionServiceContract {
  startForOwner(
    fileId: string,
    meetingId: string,
    ownerId: string,
  ): Promise<TranscriptionView>;
  getForOwner(
    fileId: string,
    meetingId: string,
    ownerId: string,
  ): Promise<TranscriptionView>;
  listForOwner(
    meetingId: string,
    ownerId: string,
  ): Promise<TranscriptionView[]>;
}

/**
 * Reaches the run table before the generated client knows about it — the
 * migration that adds `FileTranscription` is task 1.3, and these cases are
 * written first by design.
 * @param prisma - The connected Prisma service.
 * @returns The `fileTranscription` delegate, narrowed to what is used here.
 */
function transcriptionRows(prisma: PrismaService): FileTranscriptionDelegate {
  return (prisma as unknown as { fileTranscription: FileTranscriptionDelegate })
    .fileTranscription;
}

/** One destination something inside `apps/api` tried to reach during a run. */
interface RecordedDestination {
  /** Which seam saw it — `dns`, `net` or `tls`. */
  via: string;
  /** The host, address or socket path the call named. */
  target: string;
}

/**
 * Everything a run may legitimately reach: the loopback interface, in every
 * spelling Node hands the seams below.
 */
const LOOPBACK_TARGETS = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
  'localhost',
  'ip6-localhost',
]);

/**
 * Decides whether a recorded destination stays on this machine — a loopback
 * address, `localhost`, or a Unix socket path, which never leaves it at all.
 * @param target - The recorded host, address or path.
 * @returns True when the destination cannot leave the machine.
 */
function isLocal(target: string): boolean {
  if (LOOPBACK_TARGETS.has(target)) {
    return true;
  }
  return target.startsWith('/') || target.startsWith('127.');
}

/**
 * Records every outbound destination `apps/api` names for as long as it is
 * installed: `dns.lookup`, every `dns.resolve*` and their `dns.promises`
 * twins, `net.Socket.prototype.connect` and `tls.connect` (D-8 half B).
 * The patches are removed by the returned `uninstall`, which every case
 * calls in a `finally` so the recorder cannot leak into another spec.
 * @returns The growing list of destinations, and the way to stop recording.
 */
function installEgressRecorder(): {
  destinations: RecordedDestination[];
  uninstall: () => void;
} {
  const destinations: RecordedDestination[] = [];
  const restore: (() => void)[] = [];

  const dnsModule = dns as unknown as Record<string, unknown>;
  const dnsPromises = dns.promises as unknown as Record<string, unknown>;
  const resolvers = Object.keys(dnsModule).filter(
    (key) => key === 'lookup' || key.startsWith('resolve'),
  );

  /**
   * Wraps one function on a module-like object so every call records the
   * host it names before the real implementation runs.
   * @param holder - The object carrying the function.
   * @param key - The function's property name.
   * @param via - Which seam the record should be attributed to.
   */
  function record(
    holder: Record<string, unknown>,
    key: string,
    via: string,
  ): void {
    const original = holder[key];
    if (typeof original !== 'function') {
      return;
    }
    const target = original as (...args: unknown[]) => unknown;
    holder[key] = function patched(this: unknown, ...args: unknown[]): unknown {
      const [first] = args;
      if (typeof first === 'string') {
        destinations.push({ via, target: first });
      } else if (first && typeof first === 'object') {
        const options = first as { host?: string; path?: string };
        destinations.push({
          via,
          target: options.host ?? options.path ?? '(unnamed)',
        });
      }
      return Reflect.apply(target, this, args);
    };
    restore.push(() => {
      holder[key] = original;
    });
  }

  for (const key of resolvers) {
    record(dnsModule, key, 'dns');
    record(dnsPromises, key, 'dns.promises');
  }
  record(
    net.Socket.prototype as unknown as Record<string, unknown>,
    'connect',
    'net',
  );
  record(tls, 'connect', 'tls');

  return {
    destinations,
    uninstall: () => {
      for (const undo of restore.reverse()) {
        undo();
      }
    },
  };
}

describe('Transcription module (integration)', () => {
  let moduleRef: TestingModule;
  let service: TranscriptionServiceContract;
  let prisma: PrismaService;
  let storage: FileStorage;
  const createdUserIds: string[] = [];
  const createdMeetingIds: string[] = [];
  const createdFileIds: string[] = [];
  const createdStorageKeys: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        // Same env wiring as AppModule: apps/api runs with cwd=apps/api and
        // the repo keeps a single .env two levels up.
        ConfigModule.forRoot({ isGlobal: true, envFilePath: '../../.env' }),
        CqrsModule.forRoot(),
        PrismaModule,
        TranscriptionModule,
      ],
    }).compile();

    await moduleRef.init();

    service = moduleRef.get<TranscriptionServiceContract>(TranscriptionService);
    prisma = moduleRef.get(PrismaService);
    storage = moduleRef.get(FileStorage);
  });

  afterAll(async () => {
    if (createdFileIds.length > 0) {
      await transcriptionRows(prisma).deleteMany({
        where: { fileId: { in: createdFileIds } },
      });
      await prisma.meetingFile.deleteMany({
        where: { id: { in: createdFileIds } },
      });
    }
    for (const key of createdStorageKeys) {
      await storage.delete(key);
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
   * Creates an owner of their own, so nothing a case does can be reached by
   * another case's account.
   * @returns The created user's id.
   */
  async function createOwner(): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: `transcription-int-${randomUUID()}@example.com`,
        passwordHash: PASSWORD_HASH,
        consentToTerms: true,
      },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  /**
   * Stores `bytes` the way an upload would — through the `FileStorage`
   * boundary, under the same `meetings/<meetingId>/<fileId>` key shape —
   * and records the `MeetingFile` row that points at them.
   * @param ownerId - The account the meeting belongs to.
   * @param bytes - The recording's bytes.
   * @param name - The stored file name.
   * @param mimeType - The type the upload route would have detected.
   * @returns The meeting and file the run is started for.
   */
  async function storeRecording(
    ownerId: string,
    bytes: Buffer,
    name: string,
    mimeType: string,
  ): Promise<{ meetingId: string; fileId: string }> {
    const meeting = await prisma.meeting.create({
      data: {
        title: 'Transcription integration',
        date: new Date(),
        participants: [],
        ownerId,
      },
    });
    createdMeetingIds.push(meeting.id);

    const fileId = randomUUID();
    const storageKey = `meetings/${meeting.id}/${fileId}`;
    const tempPath = join(
      resolveStorageRoot(),
      'tmp',
      `transcription-int-${fileId}`,
    );
    await writeFile(tempPath, bytes);
    await storage.save(storageKey, tempPath);
    createdStorageKeys.push(storageKey);

    const file = await prisma.meetingFile.create({
      data: {
        id: fileId,
        meetingId: meeting.id,
        name,
        size: bytes.length,
        mimeType,
        storageKey,
      },
    });
    createdFileIds.push(file.id);

    return { meetingId: meeting.id, fileId: file.id };
  }

  /**
   * Reads the run's row until it reaches a final state or the budget runs
   * out — the run is started in the background, so nothing about it is true
   * the moment the start returns.
   * @param fileId - The file being transcribed.
   * @returns The finished row.
   * @throws Error if no final state is reached inside {@link RUN_TIMEOUT_MS}.
   */
  async function awaitFinishedRun(
    fileId: string,
  ): Promise<FileTranscriptionRow> {
    const deadline = Date.now() + RUN_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const row = await transcriptionRows(prisma).findUnique({
        where: { fileId },
      });
      if (row && (row.state === 'SUCCEEDED' || row.state === 'FAILED')) {
        return row;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    throw new Error(
      `The run for ${fileId} did not finish within ${RUN_TIMEOUT_MS} ms`,
    );
  }

  it(
    'answers a non-English recording in the language spoken (AC-13)',
    async () => {
      const ownerId = await createOwner();
      const { meetingId, fileId } = await storeRecording(
        ownerId,
        readSpeechFixture(RUSSIAN_SPEECH_FIXTURE),
        RUSSIAN_SPEECH_FIXTURE,
        'audio/wav',
      );

      await service.startForOwner(fileId, meetingId, ownerId);
      const row = await awaitFinishedRun(fileId);

      expect(row.state).toBe('SUCCEEDED');
      expect(row.detectedLanguage).toBe(RUSSIAN_SPEECH_LANGUAGE);

      const text = (row.text ?? '').toLowerCase();
      for (const word of readSpeechFixtureWords(RUSSIAN_SPEECH_FIXTURE)) {
        expect(text).toContain(word);
      }
    },
    RUN_TIMEOUT_MS + POLL_INTERVAL_MS * 10,
  );

  it(
    'reaches nothing but this machine for the whole of a real run (AC-12, D-8 half B)',
    async () => {
      const ownerId = await createOwner();
      const { meetingId, fileId } = await storeRecording(
        ownerId,
        readSpeechFixture(RUSSIAN_SPEECH_FIXTURE),
        RUSSIAN_SPEECH_FIXTURE,
        'audio/wav',
      );

      const recorder = installEgressRecorder();
      try {
        await service.startForOwner(fileId, meetingId, ownerId);
        await awaitFinishedRun(fileId);
      } finally {
        recorder.uninstall();
      }

      const offMachine = recorder.destinations.filter(
        (destination) => !isLocal(destination.target),
      );
      expect(offMachine).toEqual([]);
    },
    RUN_TIMEOUT_MS + POLL_INTERVAL_MS * 10,
  );

  it(
    'fails a recording whose container points outside it, storing no transcript (AC-19, S-8)',
    async () => {
      const ownerId = await createOwner();
      const { meetingId, fileId } = await storeRecording(
        ownerId,
        craftedExternalReferenceMovBytes(),
        'crafted-reference.mov',
        'video/quicktime',
      );

      const recorder = installEgressRecorder();
      let row: FileTranscriptionRow;
      try {
        await service.startForOwner(fileId, meetingId, ownerId);
        row = await awaitFinishedRun(fileId);
      } finally {
        recorder.uninstall();
      }

      expect(row.state).toBe('FAILED');
      expect(row.text).toBeNull();
      expect(row.failureReason).toEqual(expect.any(String));
      expect((row.failureReason ?? '').length).toBeLessThanOrEqual(
        MAX_FAILURE_REASON_LENGTH,
      );

      // Nothing the reference pointed at may show up anywhere the owner can
      // read: not the path, and not a line only that file carries.
      const stored = `${row.text ?? ''}${row.failureReason ?? ''}`;
      expect(stored).not.toContain(CRAFTED_EXTERNAL_REFERENCE);
      expect(stored).not.toContain('root:');
      expect(
        recorder.destinations.filter(
          (destination) => !isLocal(destination.target),
        ),
      ).toEqual([]);
    },
    RUN_TIMEOUT_MS + POLL_INTERVAL_MS * 10,
  );

  it('answers another account the same 404 as an id that never existed (AC-14, S-1)', async () => {
    const ownerId = await createOwner();
    const strangerId = await createOwner();
    const { meetingId, fileId } = await storeRecording(
      ownerId,
      craftedExternalReferenceMovBytes(),
      'ownership.mov',
      'video/quicktime',
    );

    await expect(
      service.getForOwner(fileId, meetingId, strangerId),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.startForOwner(fileId, meetingId, strangerId),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.getForOwner(randomUUID(), randomUUID(), strangerId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps the meeting-scoped state list owner-filtered, where no :fileId covers it (S-1)', async () => {
    const ownerId = await createOwner();
    const strangerId = await createOwner();
    const { meetingId } = await storeRecording(
      ownerId,
      craftedExternalReferenceMovBytes(),
      'list-scope.mov',
      'video/quicktime',
    );

    await expect(
      service.listForOwner(meetingId, strangerId),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.listForOwner(meetingId, ownerId)).resolves.toEqual(
      expect.any(Array),
    );
  });
});
