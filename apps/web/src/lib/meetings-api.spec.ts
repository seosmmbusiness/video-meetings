import { describe, expect, it } from 'vitest';
import { splitMeetingsByTime, type Meeting } from './meetings-api';

const NOW = new Date('2026-08-16T12:00:00.000Z');

/**
 * Builds a meeting with only the fields `splitMeetingsByTime` reads, so a
 * case names its date and nothing else.
 * @param id - Identifier used to assert ordering.
 * @param date - The meeting's scheduled date, as an ISO string.
 * @returns A meeting shaped like apps/api's `MeetingResponseDto`.
 */
function meetingAt(id: string, date: string): Meeting {
  return {
    id,
    title: `Meeting ${id}`,
    description: null,
    date,
    participants: [],
    ownerId: 'owner-1',
    createdAt: date,
    updatedAt: date,
  };
}

describe('splitMeetingsByTime', () => {
  it('orders upcoming meetings soonest first', () => {
    const { upcoming } = splitMeetingsByTime(
      [
        meetingAt('later', '2026-08-20T12:00:00.000Z'),
        meetingAt('sooner', '2026-08-17T12:00:00.000Z'),
      ],
      NOW,
    );

    expect(upcoming.map((meeting) => meeting.id)).toEqual(['sooner', 'later']);
  });

  it('orders past meetings most recent first and caps them at three', () => {
    const { recentPast } = splitMeetingsByTime(
      [
        meetingAt('oldest', '2026-08-01T12:00:00.000Z'),
        meetingAt('older', '2026-08-05T12:00:00.000Z'),
        meetingAt('old', '2026-08-10T12:00:00.000Z'),
        meetingAt('newest', '2026-08-15T12:00:00.000Z'),
      ],
      NOW,
    );

    expect(recentPast.map((meeting) => meeting.id)).toEqual([
      'newest',
      'old',
      'older',
    ]);
  });

  it('counts a meeting starting exactly now as upcoming, not past', () => {
    const { upcoming, recentPast } = splitMeetingsByTime(
      [meetingAt('now', NOW.toISOString())],
      NOW,
    );

    expect(upcoming.map((meeting) => meeting.id)).toEqual(['now']);
    expect(recentPast).toEqual([]);
  });
});
