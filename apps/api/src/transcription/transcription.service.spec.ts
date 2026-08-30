import { NotFoundException } from '@nestjs/common';
import type { MeetingFile } from '../../generated/prisma/client';
import { TranscriptionState } from '../../generated/prisma/client';
import type { FilesService } from '../files/files.service';
import type { MeetingsService } from '../meetings/meetings.service';
import type { PrismaService } from '../prisma/prisma.service';
import type {
  EngineSettings,
  TranscriptionEngine,
  TranscriptionResult,
} from './transcription-engine';
import { TranscriptionEngineError } from './transcription-engine';
import { MAX_FAILURE_REASON_LENGTH } from './transcription.constants';
import { TranscriptionService } from './transcription.service';

/** The settings the stub engine reports, recorded onto every run it starts. */
const ENGINE_SETTINGS: EngineSettings = {
  engine: 'local',
  model: 'tiny',
  effort: 'low',
  languageMode: 'auto',
};

/** The run row as this spec's stubbed Prisma hands it back. */
interface RunRow {
  fileId: string;
  state: TranscriptionState;
  text: string | null;
  detectedLanguage: string | null;
  failureReason: string | null;
}

/** One `fileTranscription.update` the service asked for. */
interface UpdateCall {
  where: { fileId: string };
  data: Record<string, unknown>;
}

/** One `fileTranscription.upsert` the service asked for. */
interface UpsertCall {
  where: { fileId: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}

/** One `fileTranscription.findMany` the service asked for. */
interface FindManyCall {
  where: Record<string, unknown>;
}

/** What a stubbed Prisma records while a case drives the service. */
interface PrismaRecorder {
  prisma: PrismaService;
  upserts: UpsertCall[];
  updates: UpdateCall[];
  findManyCalls: FindManyCall[];
}

/**
 * Builds a stub `PrismaService` recording every write the service makes and
 * answering reads from the rows a case seeds.
 * @param seed - The single run `findUnique` answers with, and the rows
 * `findMany` answers with.
 * @returns The stand-in service and the calls it recorded.
 */
function stubPrisma(seed: {
  run?: RunRow | null;
  runs?: Pick<RunRow, 'fileId' | 'state'>[];
}): PrismaRecorder {
  const upserts: UpsertCall[] = [];
  const updates: UpdateCall[] = [];
  const findManyCalls: FindManyCall[] = [];

  const prisma = {
    fileTranscription: {
      upsert: (args: UpsertCall) => {
        upserts.push(args);
        return Promise.resolve({
          ...args.create,
          fileId: args.where.fileId,
        });
      },
      update: (args: UpdateCall) => {
        updates.push(args);
        return Promise.resolve({ ...args.data, fileId: args.where.fileId });
      },
      findUnique: () => Promise.resolve(seed.run ?? null),
      findMany: (args: FindManyCall) => {
        findManyCalls.push(args);
        return Promise.resolve(seed.runs ?? []);
      },
    },
  } as unknown as PrismaService;

  return { prisma, upserts, updates, findManyCalls };
}

/** What a stubbed `FilesService` recorded, alongside the service itself. */
interface FilesRecorder {
  files: FilesService;
  lookups: { fileId: string; meetingId: string; ownerId: string }[];
}

/**
 * Builds a stub `FilesService` that resolves the owner's file — or refuses
 * every lookup with the same 404 the real one gives.
 * @param seed - The file every lookup resolves to, the meeting's live files,
 * and whether the lookup refuses instead.
 * @returns The stand-in service and the lookups it recorded.
 */
function stubFiles(seed: {
  file?: { id: string; storageKey: string };
  liveFileIds?: string[];
  refuse?: boolean;
}): FilesRecorder {
  const lookups: { fileId: string; meetingId: string; ownerId: string }[] = [];

  const files = {
    findFileForOwner: (fileId: string, meetingId: string, ownerId: string) => {
      lookups.push({ fileId, meetingId, ownerId });
      if (seed.refuse ?? false) {
        return Promise.reject(new NotFoundException('File not found'));
      }
      return Promise.resolve({
        id: seed.file?.id ?? fileId,
        storageKey: seed.file?.storageKey ?? `meetings/${meetingId}/${fileId}`,
      } as MeetingFile);
    },
    listForOwner: () =>
      Promise.resolve((seed.liveFileIds ?? []).map((id) => ({ id }))),
  } as unknown as FilesService;

  return { files, lookups };
}

/**
 * Builds a stub `MeetingsService` that either confirms the caller owns the
 * meeting or answers the same 404 as a meeting that never existed.
 * @param refuse - Whether the resolution refuses.
 * @returns A stand-in for `MeetingsService`.
 */
function stubMeetings(refuse = false): MeetingsService {
  return {
    findOneForOwner: () =>
      refuse
        ? Promise.reject(new NotFoundException('Meeting not found'))
        : Promise.resolve({ id: 'meeting-1' }),
  } as unknown as MeetingsService;
}

/**
 * Builds a stub engine that answers with `result`, or fails the run with
 * `error` — no engine has to be running for any case in this file (D-1).
 * @param outcome - The result to answer with, or the error to fail with.
 * @returns A stand-in for `TranscriptionEngine`.
 */
function stubEngine(outcome: {
  result?: TranscriptionResult;
  error?: Error;
}): TranscriptionEngine {
  return {
    settings: () => ENGINE_SETTINGS,
    transcribe: () =>
      outcome.error
        ? Promise.reject(outcome.error)
        : Promise.resolve(
            outcome.result ?? { text: 'hello', detectedLanguage: 'en' },
          ),
  };
}

/**
 * Lets the run the service started in the background finish: two macrotask
 * turns drain every microtask the stubbed Prisma and engine queue.
 * @returns A promise resolved once the background run has settled.
 */
async function settleBackgroundRun(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('TranscriptionService', () => {
  describe('startForOwner', () => {
    it("resolves the caller's own file before writing anything, and queues the run with the engine's settings", async () => {
      const prisma = stubPrisma({});
      const files = stubFiles({
        file: { id: 'file-1', storageKey: 'meetings/meeting-1/file-1' },
      });
      const service = new TranscriptionService(
        prisma.prisma,
        files.files,
        stubMeetings(),
        stubEngine({}),
      );

      const view = await service.startForOwner(
        'file-1',
        'meeting-1',
        'owner-1',
      );
      await settleBackgroundRun();

      expect(files.lookups).toEqual([
        { fileId: 'file-1', meetingId: 'meeting-1', ownerId: 'owner-1' },
      ]);
      expect(view.state).toBe(TranscriptionState.QUEUED);
      expect(view.fileId).toBe('file-1');
      expect(prisma.upserts).toHaveLength(1);
      expect(prisma.upserts[0].where).toEqual({ fileId: 'file-1' });
      expect(prisma.upserts[0].create).toMatchObject({
        fileId: 'file-1',
        state: TranscriptionState.QUEUED,
        ...ENGINE_SETTINGS,
      });
    });

    it("refuses another owner's file with the files module's own 404, writing nothing (AC-14, S-1)", async () => {
      const prisma = stubPrisma({});
      const files = stubFiles({ refuse: true });
      const service = new TranscriptionService(
        prisma.prisma,
        files.files,
        stubMeetings(),
        stubEngine({}),
      );

      await expect(
        service.startForOwner('file-1', 'meeting-1', 'stranger'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.upserts).toEqual([]);
      expect(prisma.updates).toEqual([]);
    });

    it('stores the transcript and its language in the one update that ends the run SUCCEEDED', async () => {
      const prisma = stubPrisma({});
      const service = new TranscriptionService(
        prisma.prisma,
        stubFiles({ file: { id: 'file-1', storageKey: 'key-1' } }).files,
        stubMeetings(),
        stubEngine({
          result: { text: 'the words spoken', detectedLanguage: 'en' },
        }),
      );

      await service.startForOwner('file-1', 'meeting-1', 'owner-1');
      await settleBackgroundRun();

      const running = prisma.updates.find(
        (call) => call.data.state === TranscriptionState.RUNNING,
      );
      expect(running).toBeDefined();

      const succeeded = prisma.updates.filter(
        (call) => call.data.state === TranscriptionState.SUCCEEDED,
      );
      expect(succeeded).toHaveLength(1);
      expect(succeeded[0].data).toMatchObject({
        text: 'the words spoken',
        detectedLanguage: 'en',
      });
      // The text is written once, in the same update that ends the run, so a
      // row can never carry half a transcript (task 1.3).
      const carriedText = prisma.updates.filter(
        (call) => typeof call.data.text === 'string',
      );
      expect(carriedText).toHaveLength(1);
    });

    it("ends the run FAILED with the engine's own reason and no transcript", async () => {
      const prisma = stubPrisma({});
      const service = new TranscriptionService(
        prisma.prisma,
        stubFiles({ file: { id: 'file-1', storageKey: 'key-1' } }).files,
        stubMeetings(),
        stubEngine({
          error: new TranscriptionEngineError(
            'The transcription engine could not be reached.',
          ),
        }),
      );

      await service.startForOwner('file-1', 'meeting-1', 'owner-1');
      await settleBackgroundRun();

      const failed = prisma.updates.filter(
        (call) => call.data.state === TranscriptionState.FAILED,
      );
      expect(failed).toHaveLength(1);
      expect(failed[0].data.text).toBeNull();
      expect(failed[0].data.failureReason).toBe(
        'The transcription engine could not be reached.',
      );
    });

    it('never lets an unexpected error put what it names into the stored reason (S-8)', async () => {
      const prisma = stubPrisma({});
      const service = new TranscriptionService(
        prisma.prisma,
        stubFiles({ file: { id: 'file-1', storageKey: 'key-1' } }).files,
        stubMeetings(),
        stubEngine({
          error: new Error('ENOENT: /srv/uploads/meetings/other/secret.mov'),
        }),
      );

      await service.startForOwner('file-1', 'meeting-1', 'owner-1');
      await settleBackgroundRun();

      const failed = prisma.updates.filter(
        (call) => call.data.state === TranscriptionState.FAILED,
      );
      expect(failed).toHaveLength(1);
      const reason = String(failed[0].data.failureReason);
      expect(reason).not.toContain('/srv/uploads');
      expect(reason.length).toBeLessThanOrEqual(MAX_FAILURE_REASON_LENGTH);
    });

    it('cuts an over-long engine reason down to what the column accepts', async () => {
      const prisma = stubPrisma({});
      const service = new TranscriptionService(
        prisma.prisma,
        stubFiles({ file: { id: 'file-1', storageKey: 'key-1' } }).files,
        stubMeetings(),
        stubEngine({
          error: new TranscriptionEngineError('x'.repeat(500)),
        }),
      );

      await service.startForOwner('file-1', 'meeting-1', 'owner-1');
      await settleBackgroundRun();

      const failed = prisma.updates.filter(
        (call) => call.data.state === TranscriptionState.FAILED,
      );
      expect(String(failed[0].data.failureReason).length).toBe(
        MAX_FAILURE_REASON_LENGTH,
      );
    });
  });

  describe('getForOwner', () => {
    it('answers a file no one has asked to transcribe with no state and no text, not with a 404', async () => {
      const prisma = stubPrisma({ run: null });
      const files = stubFiles({
        file: { id: 'file-1', storageKey: 'key-1' },
      });
      const service = new TranscriptionService(
        prisma.prisma,
        files.files,
        stubMeetings(),
        stubEngine({}),
      );

      const view = await service.getForOwner('file-1', 'meeting-1', 'owner-1');

      expect(files.lookups).toHaveLength(1);
      expect(view).toEqual({
        fileId: 'file-1',
        state: null,
        text: null,
        detectedLanguage: null,
        failureReason: null,
      });
    });

    it('answers a finished run with its state and its text', async () => {
      const prisma = stubPrisma({
        run: {
          fileId: 'file-1',
          state: TranscriptionState.SUCCEEDED,
          text: 'the words spoken',
          detectedLanguage: 'en',
          failureReason: null,
        },
      });
      const service = new TranscriptionService(
        prisma.prisma,
        stubFiles({ file: { id: 'file-1', storageKey: 'key-1' } }).files,
        stubMeetings(),
        stubEngine({}),
      );

      const view = await service.getForOwner('file-1', 'meeting-1', 'owner-1');

      expect(view.state).toBe(TranscriptionState.SUCCEEDED);
      expect(view.text).toBe('the words spoken');
    });

    it("refuses another owner's file with the same 404, reading nothing", async () => {
      const prisma = stubPrisma({ run: null });
      const service = new TranscriptionService(
        prisma.prisma,
        stubFiles({ refuse: true }).files,
        stubMeetings(),
        stubEngine({}),
      );

      await expect(
        service.getForOwner('file-1', 'meeting-1', 'stranger'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listForOwner', () => {
    it("resolves the meeting against the caller first, and never queries when it isn't theirs (S-1)", async () => {
      const prisma = stubPrisma({ runs: [] });
      const service = new TranscriptionService(
        prisma.prisma,
        stubFiles({ liveFileIds: ['file-1'] }).files,
        stubMeetings(true),
        stubEngine({}),
      );

      await expect(
        service.listForOwner('meeting-1', 'stranger'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.findManyCalls).toEqual([]);
    });

    it('filters the run query by the owner as well as the meeting, where no :fileId covers it (S-1)', async () => {
      const prisma = stubPrisma({ runs: [] });
      const service = new TranscriptionService(
        prisma.prisma,
        stubFiles({ liveFileIds: [] }).files,
        stubMeetings(),
        stubEngine({}),
      );

      await service.listForOwner('meeting-1', 'owner-1');

      expect(prisma.findManyCalls).toHaveLength(1);
      expect(prisma.findManyCalls[0].where).toEqual({
        file: {
          meetingId: 'meeting-1',
          meeting: { ownerId: 'owner-1' },
          deletedAt: null,
        },
      });
    });

    it("answers every live file's run state, with no transcript text on the wire (D-6)", async () => {
      const prisma = stubPrisma({
        runs: [{ fileId: 'file-1', state: TranscriptionState.RUNNING }],
      });
      const service = new TranscriptionService(
        prisma.prisma,
        stubFiles({ liveFileIds: ['file-1', 'file-2'] }).files,
        stubMeetings(),
        stubEngine({}),
      );

      const states = await service.listForOwner('meeting-1', 'owner-1');

      expect(states).toEqual([
        { fileId: 'file-1', state: TranscriptionState.RUNNING },
        { fileId: 'file-2', state: null },
      ]);
      expect(JSON.stringify(states)).not.toContain('text');
    });
  });
});
