'use client';

import NextLink from 'next/link';
import { linkVariants } from '@heroui/styles';
import { useActionState } from 'react';
import {
  Alert,
  Button,
  Card,
  FieldError,
  Form,
  Input,
  Label,
  TextField,
} from '@heroui/react';
import { loginAction } from '@/app/actions/auth';

/**
 * Login page — authenticates via the `loginAction` Server Action, which
 * stores the returned JWT in an `httpOnly` session cookie and redirects to
 * the home page on success.
 * @returns The rendered login page.
 */
export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(loginAction, undefined);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <Card className="w-full max-w-md">
        <Card.Header>
          <Card.Title>Welcome back</Card.Title>
          <Card.Description>Sign in to manage your meetings.</Card.Description>
        </Card.Header>
        <Card.Content>
          {state?.error ? (
            <Alert className="mb-4" status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>{state.error}</Alert.Title>
              </Alert.Content>
            </Alert>
          ) : null}

          <Form className="flex flex-col gap-4" action={formAction}>
            <TextField
              isRequired
              autoComplete="email"
              name="email"
              type="email"
            >
              <Label>Email</Label>
              <Input placeholder="you@example.com" />
              <FieldError />
            </TextField>

            <TextField
              isRequired
              autoComplete="current-password"
              name="password"
              type="password"
            >
              <Label>Password</Label>
              <Input placeholder="Enter your password" />
              <FieldError />
            </TextField>

            <Button fullWidth isPending={isPending} type="submit">
              Sign in
            </Button>
          </Form>
        </Card.Content>
        <Card.Footer>
          <p className="text-sm text-muted">
            Don&apos;t have an account?{' '}
            <NextLink className={linkVariants().base()} href="/register">
              Create one
            </NextLink>
          </p>
        </Card.Footer>
      </Card>
    </main>
  );
}
