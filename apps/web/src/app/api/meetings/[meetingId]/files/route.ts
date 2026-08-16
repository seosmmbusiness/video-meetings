import { proxyToApi } from '@/lib/api-proxy';
import { getSession } from '@/lib/session';

/**
 * Same-origin proxy for uploading a file onto a meeting: refuses an
 * unauthenticated caller before opening any upstream request (S-4), then
 * forwards to apps/api with the session's bearer token attached
 * server-side — never the caller's own `Authorization` header. The request
 * body streams onward rather than buffering (D-6), so `XMLHttpRequest`'s
 * `upload.onprogress` on the browser side reports real progress rather than
 * jumping straight to 100%.
 * @param request - The incoming multipart/form-data request.
 * @param context - Route params; Next hands `params` as a Promise.
 * @param context.params - Resolves to the meeting id.
 * @returns The proxied response: the stored file's DTO on success, or the
 * upstream refusal status and JSON body unchanged (413/415/409/507).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ meetingId: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return new Response(null, { status: 401 });
  }

  const { meetingId } = await params;
  return proxyToApi(
    request,
    session.token,
    `/meetings/${encodeURIComponent(meetingId)}/files`,
  );
}
