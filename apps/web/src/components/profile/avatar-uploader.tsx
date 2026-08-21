'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button } from '@heroui/react';
import { AVATAR_ACCEPT_ATTRIBUTE, refuseAvatar } from '@/lib/avatar-limits';

/** The same-origin proxy that carries the bytes, so the token stays server-side (D-12). */
const AVATAR_PROXY_URL = '/api/profile/avatar';

/**
 * Reads apps/api's own refusal out of a proxied response, so its wording is
 * what the user sees (AC-7, AC-8). The body is shaped like every other
 * apps/api error (`extractErrorMessage` in `lib/auth-api.ts`): a `message`
 * field holding a string or an array of `class-validator` messages.
 * @param response - The response the proxy answered with.
 * @param fallback - What to say when the body carries no message of its own;
 * the status is appended to it.
 * @returns A single human-readable refusal.
 */
async function refusalFrom(
  response: Response,
  fallback: string,
): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    message?: string | string[];
  } | null;

  if (Array.isArray(body?.message)) return body.message.join(' ');
  if (typeof body?.message === 'string') return body.message;
  return `${fallback} (${response.status}).`;
}

/**
 * The profile page's avatar control: picking an image sends it to the
 * same-origin proxy as the `avatar` part apps/api's `FileInterceptor('avatar')`
 * expects (D-12), and on success calls `router.refresh()` so the server tree
 * re-renders with the new `avatarUpdatedAt` — which changes the image URL and
 * so defeats a cached copy of the old one (D-8, AC-6).
 *
 * The size and declared-type checks here are a convenience, not the boundary:
 * they save a doomed 5 MB transfer, but only apps/api reads the bytes, so a
 * file that lies about itself is refused upstream and that refusal is shown
 * verbatim rather than reworded (AC-7, AC-8).
 *
 * An account that holds an avatar also gets a removal control, which sends
 * `DELETE` through the same proxy and refreshes the same way, returning both
 * pages to the initials fallback (AC-9).
 * @param props - What the account currently holds.
 * @param props.hasAvatar - Whether an avatar is already stored, which decides
 * whether the control reads as an upload or a replacement, and whether the
 * removal control exists at all.
 * @returns The rendered avatar control.
 */
export function AvatarUploader({ hasAvatar }: { hasAvatar: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  /**
   * Runs the browser-side checks over the chosen file and, when it passes,
   * sends it through the proxy.
   * @param file - The file the user picked.
   */
  async function upload(file: File): Promise<void> {
    // A new attempt withdraws the last refusal outright — leaving it up would
    // read as a refusal of the file just chosen.
    setRefusal(null);
    setConfirmation(null);

    const refusedInBrowser = refuseAvatar(file);
    if (refusedInBrowser) {
      setRefusal(refusedInBrowser);
      return;
    }

    const body = new FormData();
    body.append('avatar', file);

    setIsUploading(true);
    try {
      const response = await fetch(AVATAR_PROXY_URL, { method: 'POST', body });
      if (!response.ok) {
        setRefusal(await refusalFrom(response, 'Upload failed'));
        return;
      }
      // The new image is the only sign the upload worked, and an image is not
      // announced — so the outcome is also said in words.
      setConfirmation(hasAvatar ? 'Avatar replaced.' : 'Avatar uploaded.');
      // Both pages read the avatar server-side, so only a refresh shows the
      // new image without a manual reload (AC-6).
      router.refresh();
    } catch {
      setRefusal('Upload failed. Please check your connection and try again.');
    } finally {
      setIsUploading(false);
    }
  }

  /**
   * Removes the stored avatar through the same proxy, leaving it in place and
   * saying why when apps/api refuses (AC-9).
   */
  async function remove(): Promise<void> {
    setRefusal(null);
    setConfirmation(null);
    setIsRemoving(true);
    try {
      const response = await fetch(AVATAR_PROXY_URL, { method: 'DELETE' });
      if (!response.ok) {
        setRefusal(await refusalFrom(response, 'Removal failed'));
        return;
      }
      setConfirmation('Avatar removed.');
      // Both pages read `hasAvatar` server-side, so only a refresh returns
      // them to the initials fallback without a manual reload (AC-9).
      router.refresh();
    } catch {
      setRefusal('Removal failed. Please check your connection and try again.');
    } finally {
      setIsRemoving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        accept={AVATAR_ACCEPT_ATTRIBUTE}
        aria-label="Select an avatar image"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Clearing the value lets the same file be chosen again after a
          // refusal, which is otherwise a no-op the browser swallows.
          event.target.value = '';
          if (file) void upload(file);
        }}
        ref={inputRef}
        // Out of the tab order on purpose: `sr-only` hides the input without
        // removing its focusability, so a keyboard user would otherwise land
        // on an invisible stop next to the button that already opens it.
        tabIndex={-1}
        type="file"
      />
      <div className="flex items-center gap-3">
        <Button
          isPending={isUploading}
          onPress={() => inputRef.current?.click()}
          size="sm"
          variant="secondary"
        >
          {hasAvatar ? 'Replace avatar' : 'Upload avatar'}
        </Button>
        {hasAvatar ? (
          <Button
            isPending={isRemoving}
            onPress={() => void remove()}
            size="sm"
            variant="ghost"
          >
            Remove avatar
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted">PNG, JPG or WebP, up to 5 MB.</p>

      {/* The refusal lands while focus is still on the upload control, so
          without a live region a screen reader user is told nothing at all
          happened (AC-7). HeroUI's `Alert` carries no role of its own. */}
      {/* Polite, and separate from the refusal region: a success is not an
          alert, and keeping one `role="alert"` on the control leaves the
          refusal the only thing that interrupts. */}
      <p className="text-sm text-muted" role="status">
        {confirmation}
      </p>

      <div role="alert">
        {refusal ? (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{refusal}</Alert.Title>
            </Alert.Content>
          </Alert>
        ) : null}
      </div>
    </div>
  );
}
