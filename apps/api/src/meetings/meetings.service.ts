import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { MeetingResponseDto } from './dto/meeting-response.dto';

/**
 * Business logic for creating and retrieving meetings, scoped to their owner.
 */
@Injectable()
export class MeetingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a new meeting owned by the given user.
   * @param ownerId - Id of the authenticated user creating the meeting.
   * @param dto - Title, optional description, date, and participants.
   * @returns The created meeting.
   */
  create(ownerId: string, dto: CreateMeetingDto): Promise<MeetingResponseDto> {
    return this.prisma.meeting.create({
      data: {
        title: dto.title,
        description: dto.description ?? null,
        date: new Date(dto.date),
        participants: dto.participants,
        ownerId,
      },
    });
  }

  /**
   * Lists all meetings owned by the given user.
   * @param ownerId - Id of the authenticated user.
   * @returns The user's meetings, most recently created first.
   */
  findAllForOwner(ownerId: string): Promise<MeetingResponseDto[]> {
    return this.prisma.meeting.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Retrieves a single meeting owned by the given user.
   * @param id - The meeting id.
   * @param ownerId - Id of the authenticated user.
   * @returns The matching meeting.
   * @throws NotFoundException if no meeting with that id is owned by the user
   * (including when the id exists but belongs to someone else, so as not to
   * reveal other users' meeting ids).
   */
  async findOneForOwner(
    id: string,
    ownerId: string,
  ): Promise<MeetingResponseDto> {
    const meeting = await this.prisma.meeting.findFirst({
      where: { id, ownerId },
    });
    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }
    return meeting;
  }
}
