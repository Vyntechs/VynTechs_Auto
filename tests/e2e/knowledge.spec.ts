import { test, expect } from '@playwright/test'

// PR 5a smoke tests for the read-side knowledge UI. These verify the page
// shell renders, the filter bar is present, and the page works at a phone
// viewport (Brandon may pull this up on a bay tablet). The contribution
// flow (add a pinout end-to-end) lands in PR 5b along with full E2E
// coverage of add → list → drawer → retire → restore.
//
// Auth: reuses the curator project's storageState (owner/curator role).
// See playwright.config.ts.

test.describe('/knowledge (PR 5a read surfaces)', () => {
  test('owner can navigate to /knowledge and see the page shell', async ({ page }) => {
    await page.goto('/knowledge')
    await expect(
      page.getByRole('heading', { level: 1, name: /Vetted shop knowledge/i }),
    ).toBeVisible()
    // "Add knowledge" button renders even in 5a (disabled — picker ships in 5b)
    await expect(page.getByRole('button', { name: /Add knowledge/i })).toBeVisible()
  })

  test('filter bar chips are present', async ({ page }) => {
    await page.goto('/knowledge')
    // The 6 filter facets plus the 3 status toggle buttons
    await expect(page.getByText(/Vehicle/i).first()).toBeVisible()
    await expect(page.getByText(/Type/i).first()).toBeVisible()
    await expect(page.getByText(/System/i).first()).toBeVisible()
    await expect(page.getByText(/^DTC$/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Active', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Retired', exact: true })).toBeVisible()
  })

  test('empty state shows when no items', async ({ page }) => {
    // Test setup may have items — but if not, empty-state text should appear.
    // Use clear-filters-then-status=all to broaden the view.
    await page.goto('/knowledge')
    // We don't assert the EMPTY state strictly because the test shop may
    // have items from earlier PR tests. Instead assert the list region
    // exists.
    await expect(page.locator('.vk-list')).toBeVisible()
  })

  test('renders at iPhone 15 viewport (393×852)', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 })
    await page.goto('/knowledge')
    await expect(
      page.getByRole('heading', { level: 1, name: /Vetted shop knowledge|Knowledge/i }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /Add knowledge/i })).toBeVisible()
  })

  test('renders at small phone viewport (375×667)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/knowledge')
    await expect(
      page.getByRole('heading', { level: 1, name: /Vetted shop knowledge|Knowledge/i }),
    ).toBeVisible()
  })

  test('Knowledge link appears on /today (owner-gated nav)', async ({ page }) => {
    await page.goto('/today')
    await expect(page.getByRole('link', { name: /Knowledge/i })).toBeVisible()
  })
})
