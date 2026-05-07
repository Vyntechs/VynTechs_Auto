import { test, expect } from '@playwright/test'

test('serves the landing page in a well-formed English document at /', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'AI master tech for the bay.',
  )
})
