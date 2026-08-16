'use client';

import { useState } from 'react';
import { Button } from '@heroui/react';

/**
 * A per-row Preview/Hide toggle that renders a file in place — `<video>`/
 * `<audio>` for their families (seekable, since phase 1's byte route already
 * answers `Range`), `<img>` for images, an `<iframe>` for PDFs (the browser's
 * own viewer, S-8) — without ever navigating away from the meeting page.
 * Collapsed by default so N rows don't all start loading media at once. Only
 * rendered by the page for a type {@link isPreviewableType} (`lib/file-preview.ts`) accepts.
 * @param props - The file to preview.
 * @param props.src - The same-origin byte route serving this file's content.
 * @param props.mimeType - The file's detected MIME type.
 * @param props.name - The file's name, used as alt/title text for the embedded element.
 * @returns The toggle button, and the inline element once expanded.
 */
export function FilePreview({
  src,
  mimeType,
  name,
}: {
  src: string;
  mimeType: string;
  name: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        onPress={() => setExpanded((value) => !value)}
      >
        {expanded ? 'Hide' : 'Preview'}
      </Button>
      {expanded ? (
        <div className="w-full">
          {mimeType.startsWith('video/') ? (
            <video controls src={src} className="max-h-96 w-full" />
          ) : null}
          {mimeType.startsWith('audio/') ? (
            <audio controls src={src} className="w-full" />
          ) : null}
          {mimeType.startsWith('image/') ? (
            // eslint-disable-next-line @next/next/no-img-element -- a same-origin authenticated byte route isn't a next/image-optimizable remote asset.
            <img
              src={src}
              alt={name}
              className="max-h-96 w-full object-contain"
            />
          ) : null}
          {mimeType === 'application/pdf' ? (
            <iframe src={src} title={name} className="h-96 w-full" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
