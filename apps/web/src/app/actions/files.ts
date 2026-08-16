'use server';

import { refresh } from 'next/cache';
import { deleteFile, restoreFile } from '@/lib/files-api';
import { getSession } from '@/lib/session';

/**
 * Server Action backing a file row's Delete form: soft-deletes the file via
 * apps/api, deriving the caller from the session rather than trusting
 * anything but the id fields the form submits, then refreshes the current
 * route so the file moves from the live list into "Deleted files" with no
 * client-side fetch of its own.
 * @param formData - The submitted form fields (`meetingId`, `fileId`).
 */
export async function deleteFileAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const meetingId = String(formData.get('meetingId') ?? '');
  const fileId = String(formData.get('fileId') ?? '');
  if (!meetingId || !fileId) return;

  await deleteFile(session.token, meetingId, fileId);
  refresh();
}

/**
 * Server Action backing a deleted file's Restore form: restores the file via
 * apps/api (refused with the same 409 an upload gets if the meeting is
 * already full again) and refreshes the current route so it moves back into
 * the live list.
 * @param formData - The submitted form fields (`meetingId`, `fileId`).
 */
export async function restoreFileAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const meetingId = String(formData.get('meetingId') ?? '');
  const fileId = String(formData.get('fileId') ?? '');
  if (!meetingId || !fileId) return;

  await restoreFile(session.token, meetingId, fileId);
  refresh();
}
