import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Shape of a meeting as returned by the API.
 */
export class MeetingResponseDto {
  @ApiProperty({ example: 'b3f1c2a0-....' })
  id!: string;

  @ApiProperty({ example: 'Sprint planning' })
  title!: string;

  @ApiPropertyOptional({ example: 'Plan the next sprint', nullable: true })
  description!: string | null;

  @ApiProperty({ example: '2026-08-01T10:00:00.000Z' })
  date!: Date;

  @ApiProperty({ example: ['alice@example.com', 'bob@example.com'] })
  participants!: string[];

  @ApiProperty({ example: 'b3f1c2a0-....', description: 'Id of the creator' })
  ownerId!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
