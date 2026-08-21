'use client';

import { Avatar } from '@heroui/react';

/**
 * Derives the mark shown when there is no avatar image: the initials of the
 * first two words of the name, or the email's first letter when no name is set
 * (D-13). Both are rendered as text, so a name of markup stays a name (AC-16).
 * @param name - The stored display name, or `null` when none is set.
 * @param email - The account's email address, used when the name is absent.
 * @returns One or two upper-cased characters.
 */
function initialsFor(name: string | null, email: string): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return email.trim().slice(0, 1).toUpperCase();
  }

  return words
    .slice(0, 2)
    .map((word) => word.slice(0, 1))
    .join('')
    .toUpperCase();
}

/**
 * Builds the URL the avatar image is requested from: the same-origin proxy,
 * with the account's last avatar change as a cache buster so a replaced or
 * removed image can never be painted again from the browser's own copy (D-8,
 * T-1). An account whose change time is missing or unparsable still gets a
 * URL — `v=0` — rather than an image that never loads.
 * @param avatarUpdatedAt - When the avatar last changed, as the ISO string
 * apps/api returns, or `null` when it never has.
 * @returns The proxy URL for the caller's own avatar bytes.
 */
function avatarSrc(avatarUpdatedAt: string | null): string {
  const changedAt = avatarUpdatedAt ? Date.parse(avatarUpdatedAt) : Number.NaN;

  return `/api/profile/avatar?v=${Number.isNaN(changedAt) ? 0 : changedAt}`;
}

/**
 * The account's avatar mark, at a fixed rendered size so nothing shifts as the
 * image arrives (D-13): HeroUI's `Avatar.Image` over the same-origin proxy when
 * the account has an avatar, and `Avatar.Fallback` over {@link initialsFor}'s
 * characters when it does not. Both are decided from props the server already
 * resolved, so the mark is in the first server response rather than filled in
 * after mount (AC-1, AC-5); the initials showing while the image loads is an
 * image load, not a state flip (T-2). `next/image` is deliberately not used —
 * `/_next/image` fetches its source server-side without the session cookie and
 * the proxy would answer `401` (D-13).
 * @param props - Whose avatar this is.
 * @param props.name - The stored display name, or `null` when none is set.
 * @param props.email - The account's email address.
 * @param props.hasAvatar - Whether the account has avatar bytes stored.
 * @param props.avatarUpdatedAt - When the avatar last changed, as an ISO
 * string, or `null` when it never has.
 * @param props.label - The accessible label, defaulting to "Your avatar".
 * @returns The rendered avatar.
 */
export function UserAvatar({
  name,
  email,
  hasAvatar = false,
  avatarUpdatedAt = null,
  label = 'Your avatar',
}: {
  name: string | null;
  email: string;
  hasAvatar?: boolean;
  avatarUpdatedAt?: string | null;
  label?: string;
}) {
  const src = hasAvatar ? avatarSrc(avatarUpdatedAt) : null;

  return (
    // Keyed on the avatar state: HeroUI's `Avatar` remembers that an image
    // loaded, and keeps hiding its fallback even after that image is gone — so
    // a removal under a mounted mark would leave an empty mark (AC-9). A new
    // key is a new mark, with nothing remembered.
    // `role="img"` is what makes the `aria-label` count: HeroUI renders the
    // root as a plain `<span>`, and a label on a generic role is ignored — so
    // with the image's own `alt` deliberately empty the mark would have had no
    // accessible name at all.
    <Avatar
      key={src ?? 'fallback'}
      size="lg"
      role="img"
      aria-label={label}
      className="shrink-0"
    >
      {src ? (
        // `alt` is empty on purpose: the mark itself carries the accessible
        // name, so describing the image again would announce it twice.
        <Avatar.Image src={src} alt="" />
      ) : null}
      <Avatar.Fallback>{initialsFor(name, email)}</Avatar.Fallback>
    </Avatar>
  );
}
