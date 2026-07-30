import { randomUUID } from 'crypto';
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

// These specs exercise the real register/login flow against a running
// apps/api + Postgres (see apps/api/CLAUDE.md's Database section) — unlike
// home.spec.ts, they are not self-contained to apps/web alone.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const STRONG_PASSWORD = 'Str0ngPass!';

/**
 * Builds a fresh, never-before-registered email so tests don't collide with
 * each other or with previous runs against the same database.
 * @returns A unique email address.
 */
function uniqueEmail(): string {
  return `web-e2e-${randomUUID()}@example.com`;
}

/**
 * Registers an account directly against apps/api, bypassing the UI, so
 * tests that need an existing account (login, duplicate-email) don't
 * depend on the register form to set up their fixture.
 * @param request - Playwright's API request context.
 * @param email - Email to register.
 * @returns The same email, for convenience chaining into the caller.
 * @throws {Error} When the fixture registration call itself fails.
 */
async function registerViaApi(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/auth/register`, {
    data: { email, password: STRONG_PASSWORD, consentToTerms: true },
  });
  if (!response.ok()) {
    throw new Error(
      `Fixture registration for ${email} failed: ${response.status()}`,
    );
  }
  return email;
}

/**
 * Checks the "I agree to the terms of service" checkbox by clicking its
 * label text rather than the input/control directly — HeroUI's animated
 * selection indicator intercepts direct clicks mid-transition.
 * @param page - The Playwright page with the register form open.
 */
async function acceptTerms(page: Page): Promise<void> {
  await page.getByText('I agree to the terms of service').click();
}

test.describe('Registration', () => {
  test('registers a new account and signs the user in', async ({ page }) => {
    const email = uniqueEmail();
    await page.goto('/register');

    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(STRONG_PASSWORD);
    await page.locator('input[name="confirmPassword"]').fill(STRONG_PASSWORD);
    await acceptTerms(page);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  });

  test('shows an inline error when passwords do not match', async ({
    page,
  }) => {
    await page.goto('/register');

    await page.locator('input[name="email"]').fill(uniqueEmail());
    await page.locator('input[name="password"]').fill(STRONG_PASSWORD);
    await page.locator('input[name="confirmPassword"]').fill('SomethingElse1');
    await acceptTerms(page);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByText('Passwords do not match.')).toBeVisible();
    await expect(page).toHaveURL('/register');
  });

  test('shows a conflict error for an already-registered email', async ({
    page,
    request,
  }) => {
    const email = await registerViaApi(request, uniqueEmail());
    await page.goto('/register');

    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(STRONG_PASSWORD);
    await page.locator('input[name="confirmPassword"]').fill(STRONG_PASSWORD);
    await acceptTerms(page);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByText('Email is already registered')).toBeVisible();
    await expect(page).toHaveURL('/register');
  });

  test('links to the login page', async ({ page }) => {
    await page.goto('/register');
    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/login');
  });
});

test.describe('Login', () => {
  test('signs an existing user in', async ({ page, request }) => {
    const email = await registerViaApi(request, uniqueEmail());
    await page.goto('/login');

    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(STRONG_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  });

  test('shows an error for an incorrect password', async ({
    page,
    request,
  }) => {
    const email = await registerViaApi(request, uniqueEmail());
    await page.goto('/login');

    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill('WrongPass1');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText('Invalid email or password')).toBeVisible();
    await expect(page).toHaveURL('/login');
  });

  test('links to the register page', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: 'Create one' }).click();
    await expect(page).toHaveURL('/register');
  });
});

test.describe('Sign out', () => {
  test('returns the home page to the signed-out state', async ({
    page,
    request,
  }) => {
    const email = await registerViaApi(request, uniqueEmail());
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(STRONG_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(
      page.getByRole('button', { name: 'Get started' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });
});
