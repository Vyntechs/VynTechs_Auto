import { test, expect } from '@playwright/test'

// Smoke tests for the 9 read-only curator console screens. Each navigates to
// the route and asserts the page renders (heading visible, or 404 status for
// dynamic routes whose required record doesn't exist in the seeded DB).
//
// Auth: project-level storageState (see playwright.config.ts) signs in once
// as the curator/owner user via tests/e2e/global-setup.ts. The middleware
// guard + curator layout's defense-in-depth role check both pass for owners
// (lib/curator/can-curate.ts).
//
// Dynamic routes use placeholder UUIDs that will not match any seeded record;
// the page handlers call notFound() which Next.js renders as a 404. That is
// the intended graceful path — a smoke regression would crash the handler
// instead of returning 404.
const PLACEHOLDER_UUID = '00000000-0000-0000-0000-000000000000'

test.describe('curator console (signed in as owner/curator)', () => {
  test('console layout: /curator redirects to /curator/drift', async ({ page }) => {
    await page.goto('/curator/')
    await expect(page).toHaveURL(/\/curator\/drift$/)
    // Either the populated h1 or the empty-state marker. Scoped to <main> so
    // the sidebar's "Today's recommendations" link doesn't satisfy the match.
    await expect(
      page.locator('main').getByText(/Today's recommendations|Queue empty\./),
    ).toBeVisible()
  })

  test('drift queue (Screen 1) renders', async ({ page }) => {
    await page.goto('/curator/drift')
    await expect(
      page.locator('main').getByText(/Today's recommendations|Queue empty\./),
    ).toBeVisible()
  })

  test('drift drill-down (Screen 2) returns 404 for unknown alert', async ({ page }) => {
    const response = await page.goto(`/curator/drift/${PLACEHOLDER_UUID}`)
    expect(response?.status()).toBe(404)
  })

  test('full case detail (Screen 3) returns 404 for unknown session', async ({ page }) => {
    const response = await page.goto(`/curator/cases/${PLACEHOLDER_UUID}`)
    expect(response?.status()).toBe(404)
  })

  test('calibration dashboard (Screen 4) renders', async ({ page }) => {
    await page.goto('/curator/calibration')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Calibration thresholds',
    )
  })

  test('per-category history (Screen 5) renders empty state for any valid risk', async ({ page }) => {
    await page.goto('/curator/calibration/high/test-family/test-symptom')
    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toContainText('high')
    await expect(heading).toContainText('test-family')
    await expect(heading).toContainText('test-symptom')
  })

  test('deferred queue (Screen 6) renders', async ({ page }) => {
    await page.goto('/curator/deferred')
    await expect(
      page.locator('main').getByText(/Deferred cases|No deferred cases\./),
    ).toBeVisible()
  })

  test('novel-pattern queue (Screen 7) renders', async ({ page }) => {
    await page.goto('/curator/novel')
    await expect(
      page.locator('main').getByText(/Novel patterns|No novel patterns to review\./),
    ).toBeVisible()
  })

  test('corpus list (Screen 9) renders', async ({ page }) => {
    await page.goto('/curator/corpus')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Corpus entries')
  })
})
