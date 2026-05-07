import { test, expect, type Page } from '@playwright/test'

// Authed user-flow smoke. Runs in the `curator` project per
// playwright.config.ts so each test starts already signed in via the
// storageState set up in tests/e2e/global-setup.ts.
//
// Read-only: nothing is mutated. The point is "did the page handler crash?"
// — actual chat / capture / close flows are exercised at the unit test layer.
//
// Page-title a11y note: the (app) layout's pages use the AppHeader component
// which renders the page title as <div className="title">, not as <h1>.
// MainHeader (used by /intake and /curator/*) does render <h1>. The helper
// below tries both patterns so this suite stays passing if AppHeader is
// upgraded to <h1> later. See the morning summary's a11y follow-ups.
async function expectPageTitle(page: Page, expected: string | RegExp) {
  const heading = page.getByRole('heading', { level: 1, name: expected })
  const appHeaderTitle = page
    .locator('header.app-header .title')
    .filter({ hasText: expected })
  // Whichever pattern the page uses, one of these should resolve.
  const count = await heading
    .or(appHeaderTitle)
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => 1)
    .catch(() => 0)
  expect(count, `page title "${expected}" not visible`).toBe(1)
}

test.describe('authed user surfaces (signed in as owner/curator)', () => {
  test('/today renders dashboard heading', async ({ page }) => {
    await page.goto('/today')
    await expectPageTitle(page, 'Today')
  })

  test('/sessions renders sessions index', async ({ page }) => {
    await page.goto('/sessions')
    await expectPageTitle(page, 'Sessions')
  })

  test('/sessions/new renders intake form', async ({ page }) => {
    await page.goto('/sessions/new')
    await expectPageTitle(page, 'New diagnosis')
  })

  test('/billing renders subscription management', async ({ page }) => {
    await page.goto('/billing')
    // The billing page may show different states (Stripe configured vs not,
    // active sub vs none); the AppHeader title is stable across all of them.
    await expectPageTitle(page, 'Billing')
  })

  test('/intake honors NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED feature flag', async ({ page }) => {
    // The (app)/intake/layout.tsx calls notFound() unless the
    // NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED=true env var is set on the server.
    // The server's env may differ from the test runner's env (e.g. preview
    // deploy has the flag on while local .env.local doesn't), so trust the
    // response: 404 means the flag is off and notFound() fired correctly,
    // 200 means the flag is on and the form renders. Both are valid states.
    const response = await page.goto('/intake')
    const status = response?.status() ?? 0
    if (status === 404) {
      expect(status).toBe(404)
    } else {
      expect(status).toBe(200)
      await expectPageTitle(page, /who's at the counter/i)
    }
  })
})
