import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_PARTICIPANTS = 100;

/**
 * Payload for creating a new meeting.
 */
export class CreateMeetingDto {
  @ApiProperty({ example: 'Sprint planning', maxLength: MAX_TITLE_LENGTH })
  @IsString()
  @IsNotEmpty({ message: 'title must not be empty' })
  @MaxLength(MAX_TITLE_LENGTH, {
    message: `title must not exceed ${MAX_TITLE_LENGTH} characters`,
  })
  title!: string;

  @ApiPropertyOptional({
    example: 'Plan the next sprint',
    maxLength: MAX_DESCRIPTION_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH, {
    message: `description must not exceed ${MAX_DESCRIPTION_LENGTH} characters`,
  })
  description?: string;

  @ApiProperty({
    example: '2026-08-01T10:00:00.000Z',
    description: 'ISO 8601 date/time the meeting takes place',
  })
  @IsDateString(
    {},
    { message: 'date must be a valid ISO 8601 date/time string' },
  )
  date!: string;

  @ApiProperty({
    example: ['alice@example.com', 'bob@example.com'],
    type: [String],
    description: 'Email addresses of the meeting participants',
  })
  @IsArray()
  @ArrayMaxSize(MAX_PARTICIPANTS, {
    message: `participants must not exceed ${MAX_PARTICIPANTS} entries`,
  })
  @IsEmail(
    {},
    { each: true, message: 'each participant must be a valid email address' },
  )
  participants!: string[];
}
