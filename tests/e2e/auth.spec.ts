import { test, expect } from '@playwright/test'

// Auth-flow smoke. Two projects:
//   - `anonymous` runs the unauthenticated tests (no storageState).
//   - `curator` runs already-authed tests (uses storageState from
//     tests/e2e/global-setup.ts).
// playwright.config.ts decides which spec lands in which project via testMatch.
//
// Read-only: nothing is mutated. Form submission is verified at the unit-test
// layer (sign-in-page.test.tsx, sign-up-page.test.tsx).

test.describe('auth pages — anonymous', () => {
  test('GET /sign-in renders the sign-in form', async ({ page }) => {
    await page.goto('/sign-in')
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible()
    await expect(page.locator('#email')).toBeVisible()
    await expect(page.locator('#password')).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  })

  test('GET /sign-up renders the create-account form', async ({ page }) => {
    await page.goto('/sign-up')
    await expect(
      page.getByRole('heading', { name: 'Create account', level: 1 }),
    ).toBeVisible()
    await expect(page.locator('#email')).toBeVisible()
    await expect(page.locator('#password')).toBeVisible()
  })

  test('GET /today as anonymous redirects to /sign-in', async ({ page }) => {
    await page.goto('/today')
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('GET /sessions as anonymous redirects to /sign-in', async ({ page }) => {
    await page.goto('/sessions')
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('GET /billing as anonymous redirects to /sign-in', async ({ page }) => {
    await page.goto('/billing')
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('GET /intake as anonymous redirects to /sign-in', async ({ page }) => {
    // /intake lives in the (app) route group so it inherits the layout's
    // requireUserAndProfile auth gate — it is NOT a public counter page.
    await page.goto('/intake')
    await expect(page).toHaveURL(/\/sign-in/)
  })
})
