'use client';

import { useRouter } from 'next/navigation';
import NextLink from 'next/link';
import { linkVariants } from '@heroui/styles';
import { useState, type FormEvent } from 'react';
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
import { ApiError, loginAccount } from '@/lib/auth-api';
import { saveAccessToken } from '@/lib/auth-storage';

/**
 * Login page — authenticates via `POST /auth/login` and stores the returned
 * JWT on success.
 * @returns The rendered login page.
 */
export default function LoginPage() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * Submits the login form: calls the login API, stores the returned JWT,
   * and redirects to the home page.
   * @param event - The form submission event.
   */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');

    setIsSubmitting(true);
    try {
      const { accessToken } = await loginAccount({ email, password });
      saveAccessToken(accessToken);
      router.push('/');
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? error.message
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <Card className="w-full max-w-md">
        <Card.Header>
          <Card.Title>Welcome back</Card.Title>
          <Card.Description>Sign in to manage your meetings.</Card.Description>
        </Card.Header>
        <Card.Content>
          {formError ? (
            <Alert className="mb-4" status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>{formError}</Alert.Title>
              </Alert.Content>
            </Alert>
          ) : null}

          <Form className="flex flex-col gap-4" onSubmit={handleSubmit}>
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

            <Button fullWidth isPending={isSubmitting} type="submit">
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
