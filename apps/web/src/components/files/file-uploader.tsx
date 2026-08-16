'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Label, ProgressBar } from '@heroui/react';
import { FILE_SIZE_LIMIT_MESSAGE, MAX_FILE_BYTES } from '@/lib/file-limits';

/** One selected file's upload state, tracked independently of the others in the same batch. */
interface UploadRow {
  /** Client-generated id, stable across retries so the row doesn't reorder. */
  id: string;
  /** The file being uploaded, kept so Retry can re-send it from the first byte. */
  file: File;
  /** `uploading` while an `XMLHttpRequest` is in flight; `failed` once it errors or is refused. */
  status: 'uploading' | 'failed';
  /** Upload progress, 0–100; meaningless once `status` is `failed`. */
  progress: number;
  /** The refusal or failure reason shown on a failed row. */
  message?: string;
  /** The in-flight request, so Cancel can call `abort()` on it. `null` for a row that failed before any request was sent (e.g. the client-side size check). */
  xhr: XMLHttpRequest | null;
}

/**
 * Extracts a display message from an upload response body, shaped like
 * every other apps/api error response (`extractErrorMessage` in
 * `lib/auth-api.ts`): a `message` field holding either a string or an array
 * of `class-validator` messages.
 * @param responseText - The raw response body.
 * @param status - The response's HTTP status, used as a fallback message.
 * @returns A single human-readable message.
 */
function extractUploadErrorMessage(
  responseText: string,
  status: number,
): string {
  try {
    const body = JSON.parse(responseText) as { message?: string | string[] };
    if (Array.isArray(body.message)) return body.message.join(' ');
    if (typeof body.message === 'string') return body.message;
  } catch {
    // Not JSON (e.g. a network failure never reached the server) — fall
    // through to the status-based message below.
  }
  return status > 0 ? `Upload failed (${status}).` : 'Connection failed.';
}

/**
 * Multi-file uploader for a meeting's page: selecting N files starts N
 * independent `XMLHttpRequest` transfers against the same-origin upload
 * proxy, each reporting its own progress, cancellable on its own, and
 * retryable on its own if it fails — none of it disturbs the others in the
 * same batch (AC-2, AC-3, AC-4, AC-9).
 * @param props - The meeting the uploaded files belong to.
 * @param props.meetingId - Id of the meeting, used to build the upload URL.
 * @returns The rendered file picker and its in-flight upload rows.
 */
export function FileUploader({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<UploadRow[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Starts (or restarts, for Retry) the transfer for one row: builds a
   * fresh `XMLHttpRequest`, wires progress/completion/error/abort handling,
   * and sends the file as `multipart/form-data` under the `file` field
   * `FilesController.upload` expects.
   * @param row - The row to upload; its `file` is re-sent from the first byte.
   */
  function startUpload(row: UploadRow) {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/meetings/${encodeURIComponent(meetingId)}/files`);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const progress = Math.round((event.loaded / event.total) * 100);
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, progress } : r)),
      );
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setRows((prev) => prev.filter((r) => r.id !== row.id));
        router.refresh();
        return;
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? {
                ...r,
                status: 'failed',
                message: extractUploadErrorMessage(
                  xhr.responseText,
                  xhr.status,
                ),
              }
            : r,
        ),
      );
    };

    xhr.onerror = () => {
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? {
                ...r,
                status: 'failed',
                message: extractUploadErrorMessage('', 0),
              }
            : r,
        ),
      );
    };

    // A user-initiated cancel (task 5.3), not a failure: the row is removed
    // outright rather than left in the failed state task 5.4 describes.
    xhr.onabort = () => {
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    };

    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id ? { ...r, xhr, status: 'uploading', progress: 0 } : r,
      ),
    );

    const formData = new FormData();
    formData.append('file', row.file);
    xhr.send(formData);
  }

  /**
   * Adds every newly selected file as its own row and starts its transfer —
   * except a file already over {@link MAX_FILE_BYTES}, caught here before
   * any request is sent (task 5.5's browser-side half of AC-5).
   * @param files - The files chosen in the native file picker.
   */
  function handleFilesSelected(files: FileList) {
    const newRows: UploadRow[] = Array.from(files).map((file) => {
      const oversized = file.size > MAX_FILE_BYTES;
      return {
        id: crypto.randomUUID(),
        file,
        status: oversized ? 'failed' : 'uploading',
        progress: 0,
        message: oversized ? FILE_SIZE_LIMIT_MESSAGE : undefined,
        xhr: null,
      };
    });
    setRows((prev) => [...prev, ...newRows]);
    for (const row of newRows) {
      if (row.status === 'uploading') startUpload(row);
    }
  }

  /**
   * Removes a failed row without retrying it.
   * @param id - Id of the row to dismiss.
   */
  function handleDismiss(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        multiple
        aria-label="Select files to upload"
        className="sr-only"
        onChange={(event) => {
          if (event.target.files && event.target.files.length > 0) {
            handleFilesSelected(event.target.files);
          }
          // Allows re-selecting the same file after it's removed from the list.
          event.target.value = '';
        }}
      />
      <Button
        variant="secondary"
        size="sm"
        onPress={() => inputRef.current?.click()}
      >
        Upload files
      </Button>

      {rows.length > 0 ? (
        <ul aria-label="Uploads" className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id} className="rounded-md border border-default p-3">
              {row.status === 'uploading' ? (
                <div className="flex items-center gap-3">
                  <ProgressBar
                    aria-label={`Uploading ${row.file.name}`}
                    className="min-w-0 flex-1"
                    value={row.progress}
                  >
                    <Label className="truncate text-sm">{row.file.name}</Label>
                    <ProgressBar.Output
                      data-testid="upload-progress"
                      className="text-xs text-muted tabular-nums"
                    />
                    <ProgressBar.Track>
                      <ProgressBar.Fill />
                    </ProgressBar.Track>
                  </ProgressBar>
                  <Button
                    variant="tertiary"
                    size="sm"
                    onPress={() => row.xhr?.abort()}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Alert status="danger">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>{row.file.name}</Alert.Title>
                    <Alert.Description>{row.message}</Alert.Description>
                  </Alert.Content>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onPress={() => startUpload(row)}
                    >
                      Retry
                    </Button>
                    <Button
                      variant="tertiary"
                      size="sm"
                      onPress={() => handleDismiss(row.id)}
                    >
                      Dismiss
                    </Button>
                  </div>
                </Alert>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
