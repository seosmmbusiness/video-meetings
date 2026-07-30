import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { MeetingResponseDto } from './dto/meeting-response.dto';
import { MeetingsService } from './meetings.service';

/**
 * Exposes CRUD-lite endpoints for meetings, scoped to the authenticated user.
 */
@ApiTags('meetings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  /**
   * Creates a new meeting owned by the authenticated user.
   * @param user - The authenticated user, extracted from the JWT.
   * @param dto - Title, optional description, date, and participants.
   * @returns The created meeting.
   */
  @Post()
  @ApiOperation({ summary: 'Create a new meeting' })
  @ApiCreatedResponse({
    description: 'Meeting created',
    type: MeetingResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid meeting payload' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMeetingDto,
  ): Promise<MeetingResponseDto> {
    return this.meetingsService.create(user.userId, dto);
  }

  /**
   * Lists all meetings owned by the authenticated user.
   * @param user - The authenticated user, extracted from the JWT.
   * @returns The user's meetings.
   */
  @Get()
  @ApiOperation({ summary: "List the authenticated user's meetings" })
  @ApiOkResponse({
    description: 'List of meetings',
    type: [MeetingResponseDto],
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MeetingResponseDto[]> {
    return this.meetingsService.findAllForOwner(user.userId);
  }

  /**
   * Retrieves a single meeting owned by the authenticated user.
   * @param user - The authenticated user, extracted from the JWT.
   * @param id - The meeting id.
   * @returns The matching meeting.
   * @throws NotFoundException if the meeting doesn't exist or isn't owned by the user.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get a single meeting by id' })
  @ApiOkResponse({ description: 'The meeting', type: MeetingResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiNotFoundResponse({ description: 'Meeting not found' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<MeetingResponseDto> {
    return this.meetingsService.findOneForOwner(id, user.userId);
  }
}
