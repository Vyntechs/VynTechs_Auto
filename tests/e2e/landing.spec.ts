import { test, expect } from '@playwright/test'

test('serves the truthful landing page and no retired diagnostic assets', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'The repair order that keeps the whole shop moving.',
  )
  await expect(page.getByText('Operational file intake is unavailable in this release.')).toBeVisible()
  await expect(page.getByText('The diagnostic engine is unavailable in this release.')).toBeVisible()
  await expect(page.getByText(/AI master tech|confidence line|unlimited diagnostic sessions/i)).toHaveCount(0)

  for (const formerAsset of [
    '/marketing/screenshots/hero.png',
    '/marketing/screenshots/motion-03-propose.png',
  ]) {
    expect((await request.get(formerAsset)).status()).toBe(404)
  }
})
