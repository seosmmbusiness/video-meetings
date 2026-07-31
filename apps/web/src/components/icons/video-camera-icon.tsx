import type { SVGProps } from 'react';

/**
 * Renders the app's video-camera glyph (a rounded screen with a camera lens),
 * used as the visual mark on auth pages and the dashboard. Inherits color
 * from `currentColor` unless overridden via `props`.
 * @param props - Standard SVG props (e.g. `className`, `width`, `height`)
 *   forwarded to the root `<svg>` element.
 * @returns The rendered icon.
 */
export function VideoCameraIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <rect x="2" y="6" width="14" height="12" rx="3" fill="currentColor" />
      <path d="M18 10.5 22 7v10l-4-3.5z" fill="currentColor" />
    </svg>
  );
}
