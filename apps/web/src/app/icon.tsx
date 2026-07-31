import { ImageResponse } from 'next/og';

export const size = {
  width: 32,
  height: 32,
};

export const contentType = 'image/png';

/**
 * Generates the app's favicon: a video-camera glyph on a rounded accent
 * square, rendered at request time via `next/og`'s `ImageResponse`.
 * @returns The generated icon image.
 */
export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgb(4, 133, 247)',
        borderRadius: 7,
      }}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect x="2" y="6" width="14" height="12" rx="3" fill="white" />
        <path d="M18 10.5 22 7v10l-4-3.5z" fill="white" />
      </svg>
    </div>,
    { ...size },
  );
}
