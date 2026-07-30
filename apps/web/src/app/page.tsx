'use client';

import { useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card } from '@heroui/react';
import {
  clearAccessToken,
  getAccessToken,
  getEmailFromToken,
  subscribeToAccessTokenChanges,
} from '@/lib/auth-storage';

/**
 * Reads the signed-in user's email from the locally stored JWT, if any.
 * @returns The stored token's `email` claim, or `null` when signed out.
 */
function getSignedInEmailSnapshot(): string | null {
  const token = getAccessToken();
  return token ? getEmailFromToken(token) : null;
}

/** Always `null` server-side — there's no `localStorage` to read. */
function getSignedInEmailServerSnapshot(): string | null {
  return null;
}

/**
 * Home route — landing page introducing the video-meetings app. Shows
 * sign-up/sign-in actions, or a signed-in state read from the locally
 * stored JWT.
 * @returns The rendered home page.
 */
export default function Home() {
  const router = useRouter();
  const signedInEmail = useSyncExternalStore(
    subscribeToAccessTokenChanges,
    getSignedInEmailSnapshot,
    getSignedInEmailServerSnapshot,
  );

  /**
   * Signs the user out locally by clearing the stored access token.
   */
  function handleSignOut() {
    clearAccessToken();
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <Card className="w-full max-w-md">
        <Card.Header>
          <Card.Title>video-meetings</Card.Title>
          <Card.Description>
            Create and join meetings in a few clicks.
          </Card.Description>
        </Card.Header>
        {signedInEmail ? (
          <Card.Content>
            <Alert status="success">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Signed in as {signedInEmail}</Alert.Title>
              </Alert.Content>
            </Alert>
          </Card.Content>
        ) : null}
        <Card.Footer className="flex gap-3">
          {signedInEmail ? (
            <Button variant="secondary" onPress={handleSignOut}>
              Sign out
            </Button>
          ) : (
            <>
              <Button onPress={() => router.push('/register')}>
                Get started
              </Button>
              <Button variant="secondary" onPress={() => router.push('/login')}>
                Sign in
              </Button>
            </>
          )}
        </Card.Footer>
      </Card>
    </main>
  );
}
