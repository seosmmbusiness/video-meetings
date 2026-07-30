import { test, expect } from '@playwright/test';

test('home page loads and renders the Next.js starter heading', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /get started/i }),
  ).toBeVisible();
});
