import { test, expect } from '@playwright/test'

// Auth: this spec runs under the `curator` Playwright project, which applies
// project-level storageState (tests/e2e/.auth/curator.json) written by
// tests/e2e/global-setup.ts — it signs in as TEST_USER_EMAIL (a curator/owner),
// exactly like curator.spec.ts. No per-test storageState is needed, and no
// is_curator flip is required: the same authed curator the existing curator
// smoke tests rely on can reach /curator/flows.
//
// PROD-DATA CAVEAT: these tests create real flows/flow_versions rows through the
// normal authenticated app path against whatever DATABASE_URL the dev server
// uses. The partial unique index on (platform_slug, symptom_slug) WHERE
// is_retired=false means a clean RE-RUN requires the previously-created flows
// to be archived/removed first. Within a single run the two tests below pick
// DIFFERENT symptoms so they never collide with each other.

test.describe('curator flow authoring', () => {
  test('create → edit → save → publish a minimal flow', async ({ page }) => {
    await page.goto('/curator/flows')
    await expect(page.getByRole('heading', { name: 'Flows' })).toBeVisible()

    await page.getByRole('link', { name: /add new flow/i }).first().click()
    await expect(page).toHaveURL(/\/curator\/flows\/new/)

    // Catalog-sourced dropdowns always have the real options (no seeding needed).
    await page.locator('select').nth(0).selectOption({ index: 1 })
    await page.locator('select').nth(1).selectOption({ index: 1 })
    await page.locator('input[type=text], input:not([type])').first().fill('E2E test flow')
    await page.getByRole('button', { name: /create/i }).click()

    // Editor loads with one initial step.
    await expect(page.getByText(/step-1:/)).toBeVisible({ timeout: 10_000 })

    await page.getByLabel('Title').fill('Initial step')
    await page.getByLabel('Question').fill('Test question?')

    // Add an answer with → FINDING.
    await page.getByRole('button', { name: /\+ answer/i }).click()
    const answerRow = page.locator('.vt-answer-row').first()
    await answerRow.locator('input').first().fill('Yes')
    await answerRow.locator('select').selectOption('__finding')
    await answerRow.locator('input[placeholder=Verdict]').fill('Verdict')
    await answerRow.locator('input[placeholder=Action]').fill('Action')

    await page.getByPlaceholder(/change note/i).fill('Initial publish')

    await page.getByRole('button', { name: /save draft/i }).click()
    await expect(page.locator('.vt-publish-bar-saved')).toBeVisible()

    await page.getByRole('button', { name: /^publish$/i }).click()

    // Navigated to flow detail.
    await expect(page).toHaveURL(/\/curator\/flows\/[^/]+$/, { timeout: 10_000 })
    await expect(page.getByText(/current published \(v1\)/i)).toBeVisible()
  })

  test('publish gate blocks on missing change note', async ({ page }) => {
    await page.goto('/curator/flows/new')
    await page.locator('select').nth(0).selectOption({ index: 1 })
    // Different symptom than the first test so the unique (platform, symptom)
    // pair does not collide within a single run.
    await page.locator('select').nth(1).selectOption({ index: 2 })
    await page.locator('input[type=text], input:not([type])').first().fill('Gate test flow')
    await page.getByRole('button', { name: /create/i }).click()
    await expect(page.getByText(/step-1:/)).toBeVisible({ timeout: 10_000 })

    await page.getByLabel('Title').fill('Initial step')
    await page.getByLabel('Question').fill('Q?')
    await page.getByRole('button', { name: /\+ answer/i }).click()
    const row = page.locator('.vt-answer-row').first()
    await row.locator('input').first().fill('Yes')
    await row.locator('select').selectOption('__finding')
    await row.locator('input[placeholder=Verdict]').fill('V')
    await row.locator('input[placeholder=Action]').fill('A')

    // Leave change note BLANK and publish — expect a validation error, no navigation.
    await page.getByRole('button', { name: /^publish$/i }).click()
    await expect(page.locator('.vt-publish-bar-errors')).toContainText(/change note/i)
    await expect(page).toHaveURL(/\/curator\/flows\/[^/]+\/edit/)
  })
})
