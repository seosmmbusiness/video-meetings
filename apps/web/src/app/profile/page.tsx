import NextLink from 'next/link';
import { redirect } from 'next/navigation';
import { Alert, Card } from '@heroui/react';
import { linkVariants } from '@heroui/styles';
import { AvatarUploader } from '@/components/profile/avatar-uploader';
import { NameForm } from '@/components/profile/name-form';
import { PasswordForm } from '@/components/profile/password-form';
import { UserAvatar } from '@/components/profile/user-avatar';
import { ApiError, getProfile, type Profile } from '@/lib/profile-api';
import { getSession } from '@/lib/session';

/**
 * The signed-in user's profile page. Auth-gated with no signed-out state, the
 * shape the dashboard already uses: `getSession()` runs first and
 * `redirect('/login')` happens before any JSX exists, both when there is no
 * session cookie and when apps/api answers `401` for the one there is (AC-14).
 * Email, name and the avatar mark are all in the first server response — no
 * client-side read after mount (AC-1); the name is rendered as text, so a name
 * of markup stays a name (AC-16).
 * @returns The rendered profile page.
 */
export default async function ProfilePage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  let profile: Profile | null = null;
  let loadError: string | null = null;

  try {
    profile = await getProfile(session.token);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      // The cookie is present but apps/api rejects the token itself (expired,
      // tampered, or revoked by a password change elsewhere) — signed out, not
      // an error to render. Nothing of the profile has been produced at this
      // point, so nothing leaks with the redirect (AC-13, AC-14). A `403` is
      // the opposite case and never lands here: it is a refusal to render in
      // place, not a session that is gone (D-11).
      redirect('/login');
    }
    loadError =
      error instanceof ApiError
        ? error.message
        : 'Could not load your profile. Please try again later.';
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-8">
      <Card className="w-full">
        <Card.Header>
          <Card.Title>Your profile</Card.Title>
          <Card.Description>
            The name and email other people see for this account.
          </Card.Description>
        </Card.Header>
        <Card.Content>
          {profile ? (
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-4">
                <UserAvatar
                  name={profile.name}
                  email={profile.email}
                  hasAvatar={profile.hasAvatar}
                  avatarUpdatedAt={profile.avatarUpdatedAt}
                />
                <dl className="min-w-0">
                  <dt className="text-sm text-muted">Email</dt>
                  <dd className="truncate font-medium">{profile.email}</dd>
                </dl>
              </div>
              <AvatarUploader hasAvatar={profile.hasAvatar} />
              <NameForm name={profile.name} />
              <section
                aria-labelledby="password-heading"
                className="flex flex-col gap-4 border-t border-default pt-6"
              >
                <div>
                  {/* `h4`, because HeroUI's `Card.Title` above renders an
                      `h3` — this is a section within that card, not beside it. */}
                  <h4 className="text-lg font-medium" id="password-heading">
                    Password
                  </h4>
                  <p className="text-sm text-muted">
                    Changing it signs out every other device this account is
                    signed in on.
                  </p>
                </div>
                <PasswordForm />
              </section>
            </div>
          ) : (
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>{loadError}</Alert.Title>
              </Alert.Content>
            </Alert>
          )}
        </Card.Content>
        <Card.Footer>
          <NextLink className={linkVariants().base()} href="/">
            Back to the dashboard
          </NextLink>
        </Card.Footer>
      </Card>
    </main>
  );
}
