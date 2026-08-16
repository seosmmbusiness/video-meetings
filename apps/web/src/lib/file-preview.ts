/**
 * Media families rendered inline; every other accepted type has no preview
 * control at all — the browser-side mirror of `FilesController`'s
 * `isInlineType` (D-7), hand-duplicated since there's no shared types
 * package between the two apps. Plain logic, not `'use client'`, so both the
 * Server Component that decides whether to render a preview toggle and the
 * Client Component that picks the element can import it.
 */
const INLINE_MIME_PREFIXES = ['image/', 'video/', 'audio/'];
const INLINE_MIME_EXACT = new Set(['application/pdf']);

/**
 * Whether `mimeType` can be previewed in place.
 * @param mimeType - The file's stored, detected MIME type.
 * @returns `true` for image/video/audio and PDF; `false` otherwise.
 */
export function isPreviewableType(mimeType: string): boolean {
  return (
    INLINE_MIME_EXACT.has(mimeType) ||
    INLINE_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))
  );
}
