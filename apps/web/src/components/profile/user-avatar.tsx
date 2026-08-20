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
 * The account's avatar mark, at a fixed rendered size so nothing shifts once
 * phase 4 puts a real image behind it (D-13). Until then it is always HeroUI's
 * `Avatar.Fallback` over {@link initialsFor}'s characters.
 * @param props - Whose avatar this is.
 * @param props.name - The stored display name, or `null` when none is set.
 * @param props.email - The account's email address.
 * @param props.label - The accessible label, defaulting to "Your avatar".
 * @returns The rendered avatar.
 */
export function UserAvatar({
  name,
  email,
  label = 'Your avatar',
}: {
  name: string | null;
  email: string;
  label?: string;
}) {
  return (
    <Avatar size="lg" aria-label={label} className="shrink-0">
      <Avatar.Fallback>{initialsFor(name, email)}</Avatar.Fallback>
    </Avatar>
  );
}
