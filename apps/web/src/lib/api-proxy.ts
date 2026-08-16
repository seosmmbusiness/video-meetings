import 'server-only';
import { getApiBaseUrl } from './auth-api';

/**
 * Request headers forwarded upstream, verbatim, from the caller's own
 * request. Everything else — including any `Authorization` the caller sent
 * — is dropped; the upstream request always carries the server-attached
 * bearer token instead (S-4).
 */
const FORWARDED_REQUEST_HEADERS = ['content-type', 'content-length', 'range'];

/**
 * Response headers passed back to the browser unchanged, so refusal
 * messages, `Range` seeking/resuming and the upstream's `Cache-Control`
 * (S-7) survive the hop.
 */
const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-disposition',
  'accept-ranges',
  'content-range',
  'cache-control',
];

/**
 * Forwards a request to apps/api with a server-side bearer token attached,
 * rebuilding it from an allow-list of method/body/headers rather than
 * echoing the incoming request verbatim, so the caller's own `Authorization`
 * header (if any) is never forwarded and no unexpected header reaches the
 * upstream service.
 * @param request - The incoming request to this route handler.
 * @param token - The caller's session token, attached as the upstream bearer token.
 * @param path - The apps/api path to forward to, e.g. `/meetings/<id>/files/<id>/content`. Any id segments must already be `encodeURIComponent`-escaped by the caller — never interpolated into the host.
 * @returns The upstream response, with only the allow-listed headers passed through.
 */
export async function proxyToApi(
  request: Request,
  token: string,
  path: string,
): Promise<Response> {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('Authorization', `Bearer ${token}`);

  const upstream = await fetch(`${getApiBaseUrl()}${path}`, {
    method: request.method,
    headers,
    body: request.body,
    duplex: 'half',
  } as RequestInit);

  const responseHeaders = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
