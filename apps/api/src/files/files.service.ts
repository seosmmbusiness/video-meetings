import { randomUUID } from 'crypto';
import { rm } from 'fs/promises';
import { basename } from 'path';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { MeetingFile, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MeetingFileResponseDto } from './dto/meeting-file-response.dto';
import { FileTypeService } from './file-type.service';
import {
  LIVE_FILE_CAP_MESSAGE,
  MAX_FILE_NAME_LENGTH,
  MAX_LIVE_FILES_PER_MEETING,
  MAX_TOTAL_BYTES_PER_OWNER,
  PURGE_AFTER_MS,
  UNSUPPORTED_TYPE_MESSAGE,
} from './files.constants';
import { InsufficientStorageException } from './quota';
import { FileStorage } from './storage/file-storage';

/** A file as multer's `diskStorage` hands it to the controller. */
export interface UploadedDiskFile {
  originalname: string;
  path: string;
  size: number;
  mimetype: string;
}

/**
 * Strips a client-supplied file name down to something safe to store: its
 * basename (so a path-shaped name loses its directories, closing traversal),
 * with C0 control characters removed and the result bounded to
 * {@link MAX_FILE_NAME_LENGTH}.
 * @param rawName - The name as the client sent it.
 * @returns The normalized name, safe to store verbatim.
 */
function normalizeFileName(rawName: string): string {
  const base = basename(rawName);
  // eslint-disable-next-line no-control-regex -- deliberately stripping C0 control bytes
  const stripped = base.replace(/[\x00-\x1f]/g, '');
  return stripped.slice(0, MAX_FILE_NAME_LENGTH);
}

/**
 * Maps a stored `MeetingFile` row to its public response shape.
 * @param file - The Prisma row.
 * @returns The file's public DTO — never the storage key or a path.
 */
function toResponseDto(file: MeetingFile): MeetingFileResponseDto {
  return {
    id: file.id,
    meetingId: file.meetingId,
    name: file.name,
    size: file.size,
    mimeType: file.mimeType,
    createdAt: file.createdAt,
    deletedAt: file.deletedAt,
    purgeAt: file.deletedAt
      ? new Date(file.deletedAt.getTime() + PURGE_AFTER_MS)
      : null,
  };
}

/**
 * Business logic for storing, listing and serving a meeting's files, all
 * scoped to the meeting's owner.
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileStorage: FileStorage,
    private readonly fileTypeService: FileTypeService,
  ) {}

  /**
   * Stores an uploaded file's bytes and metadata against a meeting, refusing
   * it first on content-detected type (D-2), then — inside one transaction,
   * so two concurrent uploads can't both pass the same count — on the
   * meeting's live-file cap (D-5) and the owner's stored-byte ceiling (D-5,
   * S-3). A refusal at any of these stages leaves no row and no bytes.
   * @param meetingId - Id of the meeting the caller has already been
   * confirmed to own (by {@link MeetingOwnerGuard}).
   * @param file - The file multer wrote to a temp path.
   * @param ownerId - Id of the authenticated caller, for the quota check.
   * @returns The stored file's public DTO.
   * @throws UnsupportedMediaTypeException if the file's detected type isn't accepted.
   * @throws ConflictException if the meeting already holds {@link MAX_LIVE_FILES_PER_MEETING} live files.
   * @throws InsufficientStorageException if storing it would cross the owner's {@link MAX_TOTAL_BYTES_PER_OWNER} ceiling.
   */
  async create(
    meetingId: string,
    file: UploadedDiskFile,
    ownerId: string,
  ): Promise<MeetingFileResponseDto> {
    const detected = await this.fileTypeService.detect(
      file.path,
      file.originalname,
    );
    if (!detected) {
      await rm(file.path, { force: true });
      throw new UnsupportedMediaTypeException(UNSUPPORTED_TYPE_MESSAGE);
    }

    const id = randomUUID();
    const storageKey = `meetings/${meetingId}/${id}`;
    const name = normalizeFileName(file.originalname);

    let created: MeetingFile;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const liveCount = await tx.meetingFile.count({
          where: { meetingId, deletedAt: null },
        });
        if (liveCount >= MAX_LIVE_FILES_PER_MEETING) {
          throw new ConflictException(LIVE_FILE_CAP_MESSAGE);
        }

        const usedTotal = await this.ownerTotal(tx, ownerId);
        if (usedTotal + file.size > MAX_TOTAL_BYTES_PER_OWNER) {
          throw new InsufficientStorageException(
            MAX_TOTAL_BYTES_PER_OWNER - usedTotal,
          );
        }

        return tx.meetingFile.create({
          data: {
            id,
            meetingId,
            name,
            size: file.size,
            mimeType: detected.mime,
            storageKey,
          },
        });
      });
    } catch (error) {
      await rm(file.path, { force: true });
      throw error;
    }

    try {
      await this.fileStorage.save(storageKey, file.path);
    } catch (error) {
      await this.prisma.meetingFile.delete({ where: { id } });
      await rm(file.path, { force: true });
      throw error;
    }
    return toResponseDto(created);
  }

  /**
   * Sums the stored size of every file — live or soft-deleted-but-not-purged
   * — across all meetings `ownerId` owns, run inside the caller's
   * transaction so it sees the same snapshot the live-file count did.
   * @param tx - The transaction client to query through.
   * @param ownerId - Id of the account whose total is summed.
   * @returns The committed byte total, `0` when the owner has no files.
   */
  private async ownerTotal(
    tx: Prisma.TransactionClient,
    ownerId: string,
  ): Promise<number> {
    const result = await tx.meetingFile.aggregate({
      _sum: { size: true },
      where: { meeting: { ownerId } },
    });
    return result._sum.size ?? 0;
  }

  /**
   * Lists a meeting's live (not soft-deleted) files.
   * @param meetingId - Id of the meeting the caller has already been
   * confirmed to own.
   * @param ownerId - Id of the authenticated caller.
   * @returns The meeting's live files, newest first.
   */
  async listForOwner(
    meetingId: string,
    ownerId: string,
  ): Promise<MeetingFileResponseDto[]> {
    const files = await this.prisma.meetingFile.findMany({
      where: { meetingId, meeting: { ownerId }, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return files.map(toResponseDto);
  }

  /**
   * Resolves a single file, scoped to both the meeting and its owner in one
   * lookup — never by file id alone, so a file id from another owner's
   * meeting can't be reached by presenting it under a meeting the caller
   * does own.
   * @param fileId - The file id.
   * @param meetingId - Id of the meeting the file is expected to belong to.
   * @param ownerId - Id of the authenticated caller.
   * @returns The matching file row.
   * @throws NotFoundException if no live file matches all three.
   */
  async findFileForOwner(
    fileId: string,
    meetingId: string,
    ownerId: string,
  ): Promise<MeetingFile> {
    const file = await this.prisma.meetingFile.findFirst({
      where: { id: fileId, meetingId, meeting: { ownerId }, deletedAt: null },
    });
    if (!file) {
      throw new NotFoundException('File not found');
    }
    return file;
  }
}
