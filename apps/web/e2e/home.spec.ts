import { test, expect } from '@playwright/test';

test('home page loads and renders the HeroUI landing card', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'video-meetings' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Get started' })).toBeVisible();
});
