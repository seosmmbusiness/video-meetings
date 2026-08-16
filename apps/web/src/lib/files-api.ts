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

/**
 * Lists a meeting's soft-deleted, not-yet-purged files via
 * `GET /meetings/:meetingId/files/deleted`, each carrying an absolute
 * `purgeAt` — a file past its 30-day purge horizon is absent here the
 * instant it expires, whatever the cron last did (D-8).
 * @param token - The caller's JWT access token, sent as a bearer token.
 * @param meetingId - The meeting id.
 * @returns The meeting's deleted, not-yet-purged files.
 * @throws {ApiError} 404 if the meeting doesn't exist or isn't owned by the caller.
 */
export async function listDeletedFiles(
  token: string,
  meetingId: string,
): Promise<MeetingFile[]> {
  const response = await fetch(
    `${getApiBaseUrl()}/meetings/${encodeURIComponent(meetingId)}/files/deleted`,
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

/**
 * Soft-deletes a file via `DELETE /meetings/:meetingId/files/:fileId`.
 * @param token - The caller's JWT access token, sent as a bearer token.
 * @param meetingId - The meeting id.
 * @param fileId - The file id.
 * @throws {ApiError} 404 if the meeting or file doesn't exist or isn't owned by the caller.
 */
export async function deleteFile(
  token: string,
  meetingId: string,
  fileId: string,
): Promise<void> {
  const response = await fetch(
    `${getApiBaseUrl()}/meetings/${encodeURIComponent(meetingId)}/files/${encodeURIComponent(fileId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiError(
      extractErrorMessage(data, response.statusText),
      response.status,
    );
  }
}

/**
 * Restores a soft-deleted file via
 * `POST /meetings/:meetingId/files/:fileId/restore`.
 * @param token - The caller's JWT access token, sent as a bearer token.
 * @param meetingId - The meeting id.
 * @param fileId - The file id.
 * @returns The restored file's public DTO.
 * @throws {ApiError} 404 if the meeting or file doesn't exist or isn't owned by the caller; 409 if the meeting already holds 20 live files.
 */
export async function restoreFile(
  token: string,
  meetingId: string,
  fileId: string,
): Promise<MeetingFile> {
  const response = await fetch(
    `${getApiBaseUrl()}/meetings/${encodeURIComponent(meetingId)}/files/${encodeURIComponent(fileId)}/restore`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      extractErrorMessage(data, response.statusText),
      response.status,
    );
  }

  return data as MeetingFile;
}
