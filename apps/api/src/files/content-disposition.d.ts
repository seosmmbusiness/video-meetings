/**
 * `content-disposition` ships no types (no `@types` package installed
 * either — see the meeting-file-upload research); this is the minimal
 * shape this module actually calls.
 */
declare module 'content-disposition' {
  interface ContentDispositionOptions {
    type?: 'inline' | 'attachment';
    fallback?: string | boolean;
  }

  function contentDisposition(
    filename?: string,
    options?: ContentDispositionOptions,
  ): string;

  export default contentDisposition;
}
