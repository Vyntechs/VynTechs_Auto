import { test, expect } from '@playwright/test'

// PR 5a covered the read-side smoke (page shell, filter bar, empty state,
// phone viewports). PR 5b adds the contribution surface: opening the picker,
// filling a pinout form, saving, and retiring/restoring through the drawer.
//
// Auth: reuses the curator project's storageState (owner/curator role).
// See playwright.config.ts.

test.describe('/knowledge (PR 5a read surfaces)', () => {
  test('owner can navigate to /knowledge and see the page shell', async ({ page }) => {
    await page.goto('/knowledge')
    await expect(
      page.getByRole('heading', { level: 1, name: /Vetted shop knowledge/i }),
    ).toBeVisible()
    // "+ Add knowledge" is a Link in PR 5b (was a disabled button in 5a)
    await expect(page.getByRole('link', { name: /Add knowledge/i })).toBeVisible()
  })

  test('filter bar chips are present', async ({ page }) => {
    await page.goto('/knowledge')
    await expect(page.getByText(/Vehicle/i).first()).toBeVisible()
    await expect(page.getByText(/Type/i).first()).toBeVisible()
    await expect(page.getByText(/System/i).first()).toBeVisible()
    await expect(page.getByText(/^DTC$/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Active', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Retired', exact: true })).toBeVisible()
  })

  test('empty state shows when no items', async ({ page }) => {
    await page.goto('/knowledge')
    await expect(page.locator('.vk-list')).toBeVisible()
  })

  test('renders at iPhone 15 viewport (393×852)', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 })
    await page.goto('/knowledge')
    await expect(
      page.getByRole('heading', { level: 1, name: /Vetted shop knowledge|Knowledge/i }),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: /Add knowledge/i })).toBeVisible()
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

test.describe('/knowledge (PR 5b contribution flow)', () => {
  test('+ Add knowledge opens the picker dialog', async ({ page }) => {
    await page.goto('/knowledge')
    await page.getByRole('link', { name: /Add knowledge/i }).click()
    await expect(page.getByRole('dialog', { name: 'Add knowledge' })).toBeVisible()
    // Five options: P (paste primary) + 1-4 structured
    await expect(page.getByRole('dialog').getByText(/Paste reference text/i)).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('link', { name: /Pinout/ })).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('link', { name: /Connector/ })).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('link', { name: /Wiring diagram/ })).toBeVisible()
    await expect(
      page.getByRole('dialog').getByRole('link', { name: /Theory of operation/ }),
    ).toBeVisible()
  })

  test('owner adds a pinout, then retires and restores it', async ({ page }) => {
    // Unique title so reruns don't collide.
    const title = `E2E pinout ${Date.now()}`

    await page.goto('/knowledge')

    // Open picker and pick Pinout.
    await page.getByRole('link', { name: /Add knowledge/i }).click()
    await page.getByRole('dialog').getByRole('link', { name: /Pinout/ }).click()
    await expect(page).toHaveURL(/\/knowledge\/new\/pinout/)
    await expect(page.getByRole('heading', { level: 1, name: /New pinout/i })).toBeVisible()

    const form = page.locator('form.vk-form')
    // Title (first textbox in the first FieldGroup labelled "Title")
    await form
      .locator('.vk-fg')
      .filter({ hasText: /^Title$/ })
      .getByRole('textbox')
      .first()
      .fill(title)
    // Connector ref
    await form
      .locator('.vk-fg')
      .filter({ hasText: /Connector ref/i })
      .getByRole('textbox')
      .first()
      .fill('C171-E2E')
    // Vehicle scope: first scope row's Make placeholder
    await form.getByPlaceholder('Make').first().fill('Ford')
    // First pin row already has pin_number "1"; fill the signal_name column
    const firstPinRow = form.locator('.vk-pintable tbody tr').first()
    await firstPinRow.locator('td').nth(1).getByRole('textbox').fill('B+ sense')

    // Save
    await form.getByRole('button', { name: 'Save', exact: true }).click()

    // Land back on /knowledge with the drawer open.
    await page.waitForURL(/\/knowledge\?.*detail=/, { timeout: 20_000 })
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('heading', { level: 2, name: title })).toBeVisible()

    // Retire: accept the window.confirm dialog, then expect RETIRED pill.
    page.once('dialog', (d) => d.accept())
    await drawer.getByRole('button', { name: 'Retire', exact: true }).click()
    await expect(drawer.getByText('RETIRED', { exact: true })).toBeVisible({
      timeout: 10_000,
    })

    // Restore: within the 24h window the Restore button is visible.
    await drawer.getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(drawer.getByText('RETIRED', { exact: true })).toBeHidden({
      timeout: 10_000,
    })
    // Retire button should have come back.
    await expect(drawer.getByRole('button', { name: 'Retire', exact: true })).toBeVisible()
  })

  test('paste sheet opens from picker', async ({ page }) => {
    await page.goto('/knowledge')
    await page.getByRole('link', { name: /Add knowledge/i }).click()
    await page.getByRole('dialog').getByRole('button', { name: /Paste reference text/i }).click()
    await expect(page.getByRole('dialog', { name: 'Paste reference text' })).toBeVisible()
    // Hard cap is 20k; save button stays disabled when textarea is empty.
    const saveButton = page
      .getByRole('dialog', { name: 'Paste reference text' })
      .getByRole('button', { name: /Sort and review/i })
    await expect(saveButton).toBeDisabled()
  })

  test('rich-form routes are reachable', async ({ page }) => {
    // Direct nav (matches what the keyboard shortcuts 1/2/3/4 do).
    for (const [path, heading] of [
      ['/knowledge/new/pinout', /New pinout/i],
      ['/knowledge/new/connector', /New connector/i],
      ['/knowledge/new/wiring', /New wiring diagram/i],
      ['/knowledge/new/theory', /New theory of operation/i],
    ] as const) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    }
  })
})
