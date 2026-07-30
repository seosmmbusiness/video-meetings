'use client';

import { useRouter } from 'next/navigation';
import NextLink from 'next/link';
import { linkVariants } from '@heroui/styles';
import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Description,
  FieldError,
  Form,
  Input,
  Label,
  TextField,
} from '@heroui/react';
import { ApiError, registerAccount } from '@/lib/auth-api';
import { saveAccessToken } from '@/lib/auth-storage';

const PASSWORD_COMPLEXITY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;
const MAX_PASSWORD_LENGTH = 72;

/**
 * Registration page — creates a new account via `POST /auth/register` and
 * signs the user in immediately on success.
 * @returns The rendered registration page.
 */
export default function RegisterPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isPasswordInvalid =
    password.length > 0 &&
    (password.length < 8 ||
      password.length > MAX_PASSWORD_LENGTH ||
      !PASSWORD_COMPLEXITY_REGEX.test(password));
  const isConfirmInvalid =
    confirmPassword.length > 0 && confirmPassword !== password;

  /**
   * Submits the registration form: blocks on a client-side password
   * confirmation mismatch, otherwise calls the register API, stores the
   * returned JWT, and redirects to the home page.
   * @param event - The form submission event.
   */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (password !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') ?? '');
    const consentToTerms = formData.get('consentToTerms') === 'on';

    setIsSubmitting(true);
    try {
      const { accessToken } = await registerAccount({
        email,
        password,
        consentToTerms,
      });
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
          <Card.Title>Create your account</Card.Title>
          <Card.Description>
            Start hosting and joining meetings in minutes.
          </Card.Description>
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
              autoComplete="new-password"
              isInvalid={isPasswordInvalid}
              name="password"
              type="password"
              value={password}
              onChange={setPassword}
            >
              <Label>Password</Label>
              <Input placeholder="Create a password" />
              {isPasswordInvalid ? (
                <FieldError>
                  8-72 characters, with an uppercase letter, a lowercase letter,
                  and a digit.
                </FieldError>
              ) : (
                <Description>
                  At least 8 characters, with an uppercase letter, a lowercase
                  letter, and a digit.
                </Description>
              )}
            </TextField>

            <TextField
              isRequired
              autoComplete="new-password"
              isInvalid={isConfirmInvalid}
              name="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={setConfirmPassword}
            >
              <Label>Confirm password</Label>
              <Input placeholder="Re-enter your password" />
              {isConfirmInvalid ? (
                <FieldError>Passwords do not match.</FieldError>
              ) : null}
            </TextField>

            <Checkbox isRequired name="consentToTerms">
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                I agree to the terms of service
              </Checkbox.Content>
              <FieldError>You must accept the terms to continue.</FieldError>
            </Checkbox>

            <Button fullWidth isPending={isSubmitting} type="submit">
              Create account
            </Button>
          </Form>
        </Card.Content>
        <Card.Footer>
          <p className="text-sm text-muted">
            Already have an account?{' '}
            <NextLink className={linkVariants().base()} href="/login">
              Sign in
            </NextLink>
          </p>
        </Card.Footer>
      </Card>
    </main>
  );
}
