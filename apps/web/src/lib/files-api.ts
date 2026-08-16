import 'server-only';
import { ApiError, extractErrorMessage, getApiBaseUrl } from './auth-api';
import type { Meeting } from './meetings-api';

export { ApiError };

/** Shape of a meeting file as returned by apps/api's file routes, matching its `MeetingFileResponseDto`. */
export interface MeetingFile {
  id: string;
  meetingId: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: string;
  deletedAt: string | null;
  purgeAt: string | null;
}

/**
 * Fetches a single meeting owned by the caller via `GET /meetings/:id`.
 * @param token - The caller's JWT access token, sent as a bearer token.
 * @param meetingId - The meeting id.
 * @returns The matching meeting.
 * @throws {ApiError} 404 if the meeting doesn't exist or isn't owned by the caller.
 */
export async function getMeeting(
  token: string,
  meetingId: string,
): Promise<Meeting> {
  const response = await fetch(
    `${getApiBaseUrl()}/meetings/${encodeURIComponent(meetingId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    },
  );
  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      extractErrorMessage(data, response.statusText),
      response.status,
    );
  }

  return data as Meeting;
}

/**
 * Lists a meeting's live files via `GET /meetings/:meetingId/files`.
 * @param token - The caller's JWT access token, sent as a bearer token.
 * @param meetingId - The meeting id.
 * @returns The meeting's live files.
 * @throws {ApiError} 404 if the meeting doesn't exist or isn't owned by the caller.
 */
export async function listFiles(
  token: string,
  meetingId: string,
): Promise<MeetingFile[]> {
  const response = await fetch(
    `${getApiBaseUrl()}/meetings/${encodeURIComponent(meetingId)}/files`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    },
  );
  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      extractErrorMessage(data, response.statusText),
      response.status,
    );
  }

  return data as MeetingFile[];
}
