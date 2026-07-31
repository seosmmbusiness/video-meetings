import 'server-only';
import { ApiError, extractErrorMessage, getApiBaseUrl } from './auth-api';

export { ApiError };

/** Shape of a meeting as returned by apps/api's `GET /meetings`, matching its `MeetingResponseDto`. */
export interface Meeting {
  id: string;
  title: string;
  description: string | null;
  date: string;
  participants: string[];
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Lists the authenticated user's meetings via `GET /meetings`.
 * @param token - The caller's JWT access token, sent as a bearer token.
 * @returns The user's meetings, newest-created first (per apps/api's ordering).
 * @throws {ApiError} When the request fails (e.g. an expired/invalid token).
 */
export async function listMeetings(token: string): Promise<Meeting[]> {
  const response = await fetch(`${getApiBaseUrl()}/meetings`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      extractErrorMessage(data, response.statusText),
      response.status,
    );
  }

  return data as Meeting[];
}

/**
 * Splits meetings into upcoming (today or later) and the three most recent
 * past meetings, for the home page's two list sections.
 * @param meetings - The full list of meetings to split.
 * @param now - The reference time to split around (defaults to the current time).
 * @returns `upcoming` (soonest first) and `recentPast` (most recently held first, capped at 3).
 */
export function splitMeetingsByTime(
  meetings: Meeting[],
  now: Date = new Date(),
): { upcoming: Meeting[]; recentPast: Meeting[] } {
  const nowMs = now.getTime();
  const upcoming = meetings
    .filter((meeting) => new Date(meeting.date).getTime() >= nowMs)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const recentPast = meetings
    .filter((meeting) => new Date(meeting.date).getTime() < nowMs)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 3);

  return { upcoming, recentPast };
}
