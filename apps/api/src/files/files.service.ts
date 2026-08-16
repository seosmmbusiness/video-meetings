import { randomUUID } from 'crypto';
import { basename } from 'path';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { MeetingFile } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MeetingFileResponseDto } from './dto/meeting-file-response.dto';
import { MAX_FILE_NAME_LENGTH, PURGE_AFTER_MS } from './files.constants';
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
  ) {}

  /**
   * Stores an uploaded file's bytes and metadata against a meeting.
   * @param meetingId - Id of the meeting the caller has already been
   * confirmed to own (by {@link MeetingOwnerGuard}).
   * @param file - The file multer wrote to a temp path.
   * @returns The stored file's public DTO.
   */
  async create(
    meetingId: string,
    file: UploadedDiskFile,
  ): Promise<MeetingFileResponseDto> {
    const id = randomUUID();
    const storageKey = `meetings/${meetingId}/${id}`;
    const created = await this.prisma.meetingFile.create({
      data: {
        id,
        meetingId,
        name: normalizeFileName(file.originalname),
        size: file.size,
        mimeType: file.mimetype,
        storageKey,
      },
    });
    try {
      await this.fileStorage.save(storageKey, file.path);
    } catch (error) {
      await this.prisma.meetingFile.delete({ where: { id } });
      throw error;
    }
    return toResponseDto(created);
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
