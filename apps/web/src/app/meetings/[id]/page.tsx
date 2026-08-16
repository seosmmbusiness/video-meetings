import { notFound, redirect } from 'next/navigation';
import { Card, Chip, EmptyState } from '@heroui/react';
import { buttonVariants } from '@heroui/styles';
import { deleteFileAction, restoreFileAction } from '@/app/actions/files';
import { FilePreview } from '@/components/files/file-preview';
import { FileUploader } from '@/components/files/file-uploader';
import { isPreviewableType } from '@/lib/file-preview';
import {
  ApiError,
  getMeeting,
  listDeletedFiles,
  listFiles,
  type MeetingFile,
} from '@/lib/files-api';
import type { Meeting } from '@/lib/meetings-api';
import { getSession } from '@/lib/session';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/**
 * Formats an ISO date string for display.
 * @param date - An ISO 8601 date/time string.
 * @returns A human-readable date/time, e.g. "Aug 1, 2026, 10:00 AM".
 */
function formatDate(date: string): string {
  return dateFormatter.format(new Date(date));
}

/**
 * Formats a byte count for display, choosing the largest unit that keeps
 * the number readable.
 * @param bytes - The size in bytes.
 * @returns A human-readable size, e.g. "12 B", "3.4 KB", "1.20 GB".
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

/**
 * Formats the time left before a deleted file is permanently purged.
 * @param purgeAt - The file's absolute purge timestamp (an ISO 8601 string).
 * @returns A human-readable countdown, e.g. "1 day left", "12 days left".
 */
function formatTimeLeft(purgeAt: string): string {
  const daysLeft = Math.max(
    0,
    Math.ceil((new Date(purgeAt).getTime() - Date.now()) / 86_400_000),
  );
  if (daysLeft === 0) return 'Purging today';
  if (daysLeft === 1) return '1 day left';
  return `${daysLeft} days left`;
}

/**
 * Renders a single uploaded file as a list row: its name, size, detected
 * type, upload time, a Preview toggle for previewable types, and controls to
 * download or delete it.
 * @param props - The file to render, and the meeting it belongs to.
 * @param props.file - The file.
 * @param props.meetingId - Id of the meeting the file belongs to.
 * @returns The rendered list item.
 */
function FileListItem({
  file,
  meetingId,
}: {
  file: MeetingFile;
  meetingId: string;
}) {
  const contentUrl = `/api/meetings/${encodeURIComponent(meetingId)}/files/${encodeURIComponent(file.id)}/content`;
  return (
    <li className="flex flex-col gap-2 border-b border-default py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate font-medium">{file.name}</p>
          <p className="text-sm text-muted">
            {formatFileSize(file.size)} · {file.mimeType} ·{' '}
            {formatDate(file.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a
            href={contentUrl}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            Download
          </a>
          <form action={deleteFileAction}>
            <input type="hidden" name="meetingId" value={meetingId} />
            <input type="hidden" name="fileId" value={file.id} />
            <button
              type="submit"
              className={buttonVariants({ variant: 'tertiary', size: 'sm' })}
            >
              Delete
            </button>
          </form>
        </div>
      </div>
      {isPreviewableType(file.mimeType) ? (
        <FilePreview
          src={contentUrl}
          mimeType={file.mimeType}
          name={file.name}
        />
      ) : null}
    </li>
  );
}

/**
 * Renders a single deleted file as a list row: its name, the time left
 * before it's permanently purged, and a control to restore it.
 * @param props - The file to render, and the meeting it belongs to.
 * @param props.file - The deleted file; its `purgeAt` is always set for
 * anything returned by the deleted-files listing.
 * @param props.meetingId - Id of the meeting the file belongs to.
 * @returns The rendered list item.
 */
function DeletedFileListItem({
  file,
  meetingId,
}: {
  file: MeetingFile;
  meetingId: string;
}) {
  return (
    <li className="flex items-center justify-between gap-4 border-b border-default py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate font-medium">{file.name}</p>
        <p className="text-sm text-muted">
          {file.purgeAt ? formatTimeLeft(file.purgeAt) : null}
        </p>
      </div>
      <form action={restoreFileAction}>
        <input type="hidden" name="meetingId" value={meetingId} />
        <input type="hidden" name="fileId" value={file.id} />
        <button
          type="submit"
          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
        >
          Restore
        </button>
      </form>
    </li>
  );
}

/**
 * Renders the meeting's read-only fields: title, description, date and
 * participants.
 * @param props - The meeting to render.
 * @param props.meeting - The meeting.
 * @returns The rendered card.
 */
function MeetingDetails({ meeting }: { meeting: Meeting }) {
  return (
    <Card className="w-full">
      <Card.Header>
        <Card.Title>{meeting.title}</Card.Title>
        {meeting.description ? (
          <Card.Description>{meeting.description}</Card.Description>
        ) : null}
      </Card.Header>
      <Card.Content className="flex flex-col gap-3">
        <p className="text-sm text-muted">{formatDate(meeting.date)}</p>
        <div className="flex flex-wrap gap-2">
          {meeting.participants.map((participant) => (
            <Chip key={participant} size="sm">
              <Chip.Label>{participant}</Chip.Label>
            </Chip>
          ))}
        </div>
      </Card.Content>
    </Card>
  );
}

/**
 * Renders the meeting's files, or an empty-state message when none have
 * been uploaded yet.
 * @param props - The meeting id and its files.
 * @param props.meetingId - Id of the meeting the files belong to.
 * @param props.files - The meeting's live files.
 * @returns The rendered card.
 */
function FilesSection({
  meetingId,
  files,
}: {
  meetingId: string;
  files: MeetingFile[];
}) {
  return (
    <Card className="w-full">
      <Card.Header>
        <Card.Title>Files</Card.Title>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <FileUploader meetingId={meetingId} />
        {files.length > 0 ? (
          <ul aria-label="Files">
            {files.map((file) => (
              <FileListItem key={file.id} file={file} meetingId={meetingId} />
            ))}
          </ul>
        ) : (
          <EmptyState>No files have been uploaded yet.</EmptyState>
        )}
      </Card.Content>
    </Card>
  );
}

/**
 * Renders the meeting's soft-deleted, not-yet-purged files, or an
 * empty-state message when there are none. A file past its 30-day purge
 * horizon is absent from `files` the instant it expires (D-8), so nothing
 * here needs to account for the purge cron's own schedule.
 * @param props - The meeting id and its deleted files.
 * @param props.meetingId - Id of the meeting the files belong to.
 * @param props.files - The meeting's deleted, not-yet-purged files.
 * @returns The rendered card.
 */
function DeletedFilesSection({
  meetingId,
  files,
}: {
  meetingId: string;
  files: MeetingFile[];
}) {
  return (
    <Card className="w-full">
      <Card.Header>
        <Card.Title>Deleted files</Card.Title>
      </Card.Header>
      <Card.Content>
        {files.length > 0 ? (
          <ul aria-label="Deleted files">
            {files.map((file) => (
              <DeletedFileListItem
                key={file.id}
                file={file}
                meetingId={meetingId}
              />
            ))}
          </ul>
        ) : (
          <EmptyState>Nothing has been deleted.</EmptyState>
        )}
      </Card.Content>
    </Card>
  );
}

/**
 * Meeting page — a signed-in owner's read-only view of one meeting and its
 * files. Requires an active session (redirects to `/login` before rendering
 * otherwise); a meeting the caller does not own renders exactly what a
 * nonexistent id renders (AC-15), since apps/api's ownership check answers
 * the same 404 for both.
 * @param props - The route's params.
 * @param props.params - Resolves to the meeting id (Next hands `params` as a Promise).
 * @returns The rendered page.
 */
export default async function MeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  let meeting: Meeting;
  let files: MeetingFile[];
  let deletedFiles: MeetingFile[];
  try {
    meeting = await getMeeting(session.token, id);
    files = await listFiles(session.token, id);
    deletedFiles = await listDeletedFiles(session.token, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      // The cookie is present but apps/api rejects the token itself
      // (expired or tampered) — treat that as signed-out, same as the home
      // page does.
      redirect('/login');
    }
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-8">
      <MeetingDetails meeting={meeting} />
      <FilesSection meetingId={id} files={files} />
      <DeletedFilesSection meetingId={id} files={deletedFiles} />
    </main>
  );
}
