import { proxyToApi } from '@/lib/api-proxy';
import { getSession } from '@/lib/session';

/**
 * The apps/api path this route is allowed to reach. It is fixed and carries
 * no caller-controlled segment at all — whatever the browser appends to the
 * route's own URL (`?v=<avatarUpdatedAt>` to defeat a cached copy, per D-8)
 * never becomes part of the upstream path (AC-17, D-12).
 */
const UPSTREAM_PATH = '/profile/avatar';

/**
 * Serves the signed-in account's avatar bytes through the same-origin proxy,
 * so the session token stays server-side: the browser requests
 * `/api/profile/avatar?v=<avatarUpdatedAt epoch ms>` and gets apps/api's
 * response — the image with its `Content-Type`, `Content-Disposition: inline`
 * and `Cache-Control: private, max-age=60` (T-1), or `404` when the account holds no
 * avatar (D-8, AC-9).
 * @param request - The incoming request to this route handler.
 * @returns The proxied response, or `401` with no body when signed out.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return new Response(null, { status: 401 });
  }

  return proxyToApi(request, session.token, UPSTREAM_PATH);
}

/**
 * Uploads or replaces the signed-in account's avatar. The bytes cannot go
 * through a Server Action: Next caps an action's request body at 1 MB by
 * default, against a 5 MB avatar (D-12). The body streams onward rather than
 * buffering, and apps/api's own refusal — size, declared type or content —
 * comes back unchanged so the browser can show its wording verbatim
 * (AC-6, AC-7, AC-8).
 * @param request - The incoming multipart/form-data request.
 * @returns The proxied response, or `401` with no body when signed out.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return new Response(null, { status: 401 });
  }

  return proxyToApi(request, session.token, UPSTREAM_PATH);
}

/**
 * Removes the signed-in account's avatar, returning both pages to the
 * initials fallback (AC-9).
 * @param request - The incoming request to this route handler.
 * @returns The proxied response, or `401` with no body when signed out.
 */
export async function DELETE(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return new Response(null, { status: 401 });
  }

  return proxyToApi(request, session.token, UPSTREAM_PATH);
}
