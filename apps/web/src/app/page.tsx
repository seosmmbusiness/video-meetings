import NextLink from 'next/link';
import { buttonVariants } from '@heroui/styles';
import { Alert, Button, Card } from '@heroui/react';
import { logoutAction } from '@/app/actions/auth';
import { getSession } from '@/lib/session';

/**
 * Home route — landing page introducing the video-meetings app. Shows
 * sign-up/sign-in links, or a signed-in state read from the session cookie
 * before the page renders (no client-side flash).
 * @returns The rendered home page.
 */
export default async function Home() {
  const session = await getSession();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <Card className="w-full max-w-md">
        <Card.Header>
          <Card.Title>video-meetings</Card.Title>
          <Card.Description>
            Create and join meetings in a few clicks.
          </Card.Description>
        </Card.Header>
        {session ? (
          <Card.Content>
            <Alert status="success">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Signed in as {session.email}</Alert.Title>
              </Alert.Content>
            </Alert>
          </Card.Content>
        ) : null}
        <Card.Footer className="flex gap-3">
          {session ? (
            <form action={logoutAction}>
              <Button variant="secondary" type="submit">
                Sign out
              </Button>
            </form>
          ) : (
            <>
              <NextLink className={buttonVariants()} href="/register">
                Get started
              </NextLink>
              <NextLink
                className={buttonVariants({ variant: 'secondary' })}
                href="/login"
              >
                Sign in
              </NextLink>
            </>
          )}
        </Card.Footer>
      </Card>
    </main>
  );
}
