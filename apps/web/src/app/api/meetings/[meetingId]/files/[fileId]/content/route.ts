import { proxyToApi } from '@/lib/api-proxy';
import { getSession } from '@/lib/session';

/**
 * Same-origin proxy for a file's bytes: refuses an unauthenticated caller
 * before opening any upstream request (S-4), then forwards to apps/api with
 * the session's bearer token attached server-side — never the caller's own
 * `Authorization` header, and never a browser-visible credential, since a
 * `<video>`/`<img>`/`<a download>` can carry this same-origin `httpOnly`
 * cookie but not a header (D-6).
 * @param request - The incoming request.
 * @param context - Route params; Next hands `params` as a Promise.
 * @param context.params - Resolves to the meeting and file ids.
 * @returns The proxied file bytes, or `401` with no body when signed out.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ meetingId: string; fileId: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return new Response(null, { status: 401 });
  }

  const { meetingId, fileId } = await params;
  return proxyToApi(
    request,
    session.token,
    `/meetings/${encodeURIComponent(meetingId)}/files/${encodeURIComponent(fileId)}/content`,
  );
}
