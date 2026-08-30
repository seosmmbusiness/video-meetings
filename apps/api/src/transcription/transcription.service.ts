import { Injectable, Logger } from '@nestjs/common';
import { TranscriptionState } from '../../generated/prisma/client';
import { FilesService } from '../files/files.service';
import { MeetingsService } from '../meetings/meetings.service';
import { PrismaService } from '../prisma/prisma.service';
import { TranscriptionResponseDto } from './dto/transcription-response.dto';
import { TranscriptionStateResponseDto } from './dto/transcription-state-response.dto';
import { TranscriptionEngine } from './transcription-engine';
import {
  RUN_VIEW_COLUMNS,
  failureReasonOf,
  toTranscriptionResponse,
} from './transcription-view';

/**
 * Starts transcription runs and answers what they came to. Every route's
 * ownership is resolved here as well as at the guard, through the files
 * module's own public surface rather than a copied `where` clause — the
 * per-file routes through `FilesService.findFileForOwner`, the meeting-scoped
 * list through `MeetingsService.findOneForOwner` plus an owner-filtered query,
 * since a route with no `:fileId` has no cover from the former (D-9, S-1).
 */
@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);

  /**
   * @param prisma - Reads and writes the run rows.
   * @param files - Resolves an owner's file, and lists a meeting's live ones.
   * @param meetings - Resolves a meeting against the caller for the list route.
   * @param engine - Turns the stored recording into text (D-1).
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly meetings: MeetingsService,
    private readonly engine: TranscriptionEngine,
  ) {}

  /**
   * Starts a run for one of the caller's own files and answers immediately —
   * the engine works in the background, so the transcript is only ever
   * visible to a later read.
   * @param fileId - The file to transcribe.
   * @param meetingId - The meeting it is presented under.
   * @param ownerId - The authenticated caller.
   * @returns The queued run, as the caller sees it.
   * @throws NotFoundException if the file is not the caller's, exactly as for
   * a file that never existed.
   */
  async startForOwner(
    fileId: string,
    meetingId: string,
    ownerId: string,
  ): Promise<TranscriptionResponseDto> {
    const file = await this.files.findFileForOwner(fileId, meetingId, ownerId);
    const settings = this.engine.settings();
    const queued = {
      state: TranscriptionState.QUEUED,
      text: null,
      failureReason: null,
      detectedLanguage: null,
      ...settings,
    };

    const run = await this.prisma.fileTranscription.upsert({
      where: { fileId: file.id },
      create: { fileId: file.id, ...queued },
      update: {
        ...queued,
        queuedAt: new Date(),
        startedAt: null,
        endedAt: null,
      },
      select: RUN_VIEW_COLUMNS,
    });

    void this.execute(file.id, file.storageKey);

    return toTranscriptionResponse(file.id, run);
  }

  /**
   * Answers one file's run — its state, and its text once it has one.
   * @param fileId - The file to read.
   * @param meetingId - The meeting it is presented under.
   * @param ownerId - The authenticated caller.
   * @returns The run, or an empty state when nobody has asked for one.
   * @throws NotFoundException if the file is not the caller's.
   */
  async getForOwner(
    fileId: string,
    meetingId: string,
    ownerId: string,
  ): Promise<TranscriptionResponseDto> {
    const file = await this.files.findFileForOwner(fileId, meetingId, ownerId);
    const run = await this.prisma.fileTranscription.findUnique({
      where: { fileId: file.id },
      select: RUN_VIEW_COLUMNS,
    });
    return toTranscriptionResponse(file.id, run);
  }

  /**
   * Answers the run state of every live file of one meeting, and no
   * transcript text — the shape the meeting's page polls (D-6).
   * @param meetingId - The meeting to report on.
   * @param ownerId - The authenticated caller.
   * @returns One entry per live file, `state` null where there is no run.
   * @throws NotFoundException if the meeting is not the caller's, exactly as
   * for a meeting that never existed.
   */
  async listForOwner(
    meetingId: string,
    ownerId: string,
  ): Promise<TranscriptionStateResponseDto[]> {
    await this.meetings.findOneForOwner(meetingId, ownerId);

    const runs = await this.prisma.fileTranscription.findMany({
      where: {
        file: { meetingId, meeting: { ownerId }, deletedAt: null },
      },
      select: { fileId: true, state: true },
    });
    const stateByFile = new Map(runs.map((run) => [run.fileId, run.state]));

    const files = await this.files.listForOwner(meetingId, ownerId);
    return files.map((file) => ({
      fileId: file.id,
      state: stateByFile.get(file.id) ?? null,
    }));
  }

  /**
   * Runs one transcription to its end and records how it went. Nothing here
   * ever rejects into the request that started it: every way the engine can
   * disappoint is a failed run, the same way the root `CLAUDE.md` requires of
   * optional infrastructure.
   * @param fileId - The file being transcribed.
   * @param storageKey - Backend-agnostic key of its stored bytes.
   * @returns A promise resolved once the run has been recorded either way.
   */
  private async execute(fileId: string, storageKey: string): Promise<void> {
    // The engine bounds its own call at `WHISPER_TIMEOUT_MS`; this controller
    // is what phase 2's scheduler will abort a run through.
    const controller = new AbortController();
    try {
      await this.prisma.fileTranscription.update({
        where: { fileId },
        data: { state: TranscriptionState.RUNNING, startedAt: new Date() },
      });
      const result = await this.engine.transcribe(
        storageKey,
        controller.signal,
      );
      // The text is written once, in the same update that ends the run, so a
      // row can never be swept carrying half a transcript (task 1.3).
      await this.prisma.fileTranscription.update({
        where: { fileId },
        data: {
          state: TranscriptionState.SUCCEEDED,
          text: result.text,
          detectedLanguage: result.detectedLanguage,
          failureReason: null,
          endedAt: new Date(),
        },
      });
    } catch (error) {
      await this.recordFailure(fileId, error);
    }
  }

  /**
   * Records a run that ended without a transcript, and logs — never throws —
   * if even that write fails, since nothing is waiting on this promise.
   * @param fileId - The file whose run failed.
   * @param error - Whatever ended it.
   * @returns A promise resolved once the failure has been recorded or logged.
   */
  private async recordFailure(fileId: string, error: unknown): Promise<void> {
    try {
      await this.prisma.fileTranscription.update({
        where: { fileId },
        data: {
          state: TranscriptionState.FAILED,
          text: null,
          failureReason: failureReasonOf(error),
          endedAt: new Date(),
        },
      });
    } catch (writeError) {
      this.logger.error(
        `Could not record the failed run for file ${fileId}`,
        writeError instanceof Error ? writeError.stack : undefined,
      );
    }
  }
}
