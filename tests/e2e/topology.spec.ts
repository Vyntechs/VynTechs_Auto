import { test, expect, type Page } from '@playwright/test'

// PR-C/B validation walkthrough. Confirms the interactive electrical topology
// page renders and responds to scenario controls without runtime errors. Runs
// against a clone of the F-350 / P0087 fixture owned by the dedicated e2e
// user (see scripts/setup-e2e-user.mjs) — the original session stays owned
// by Brandon for manual visual sign-off.
//
// Auth: project-level storageState (signed in as TEST_USER_EMAIL).
const TARGET_SESSION = '185b1a86-14b0-4832-89dc-3e95a3d62b86'

// Attach a guard that fails the test if any uncaught browser error or HTTP
// 500 lands during navigation. Without this, a JS runtime error or a server
// crash would silently pass since none of the visible assertions touch it.
function trackErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`HTTP ${res.status()} ${res.url()}`)
  })
  return errors
}

test.describe('PR-C/B — Interactive electrical topology', () => {
  test('page loads without runtime error or 500', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto(`/sessions/${TARGET_SESSION}`)

    // The Next.js dev runtime-error overlay surfaces both of these strings.
    await expect(page.getByText('Runtime Error', { exact: false })).toHaveCount(0)
    await expect(page.getByText('Failed query', { exact: false })).toHaveCount(0)

    expect(errors).toEqual([])
  })

  test('key surfaces are visible', async ({ page }) => {
    await page.goto(`/sessions/${TARGET_SESSION}`)

    // Symptom title + vehicle line in the header
    await expect(page.locator('.topo__title')).toBeVisible()
    await expect(page.locator('.topo__vehicle')).toBeVisible()

    // Compositional scenario picker
    await expect(
      page.getByRole('group', { name: 'Scenario simulator' }),
    ).toBeVisible()

    // Active-scenario readout
    await expect(page.locator('.topo__readout')).toBeVisible()
  })

  // Guards against the "canvas collapses to zero height" class of bug.
  // The chrome around the diagram can all be visible while the diagram
  // itself paints into a near-zero-height container — react-flow happily
  // mounts nodes into a tiny clipped viewport, so checking node visibility
  // alone is too lenient. We assert on the canvas container's measured
  // height instead: any useful diagram needs at least ~300px of vertical
  // real estate to show even a few components without scroll.
  test('diagram canvas has usable height (not collapsed)', async ({ page }) => {
    await page.goto(`/sessions/${TARGET_SESSION}`)
    const canvas = page.locator('.topo__canvas')
    await expect(canvas).toBeVisible()
    const box = await canvas.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThan(300)
    // A component node must also be visible inside that usable canvas.
    await expect(page.locator('.topo-node').first()).toBeVisible({
      timeout: 10_000,
    })
  })

  test('flipping the ignition control updates the readout', async ({ page }) => {
    await page.goto(`/sessions/${TARGET_SESSION}`)
    const readout = page.locator('.topo__readout')
    await expect(readout).toBeVisible()
    const initial = ((await readout.textContent()) ?? '').trim()

    // Default is Idle (ignition on / engine running / load idle). Click
    // "Ignition off" and confirm the readout text changes to a different
    // scenario label (we don't pin the exact text — just that it moved).
    await page.getByRole('button', { name: 'Ignition off' }).click()
    await expect
      .poll(async () => ((await readout.textContent()) ?? '').trim())
      .not.toBe(initial)
  })

  test('mobile viewport: page stacks vertically without overflow error', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const errors = trackErrors(page)
    await page.goto(`/sessions/${TARGET_SESSION}`)

    await expect(page.locator('.topo__title')).toBeVisible()
    await expect(
      page.getByRole('group', { name: 'Scenario simulator' }),
    ).toBeVisible()

    // Mobile uses a different CSS path than desktop (block layout instead
    // of flex), and react-flow's height: 100% only resolves against a
    // parent with explicit `height` — not just `min-height`. This
    // assertion catches the class of bug where the mobile canvas has the
    // right outer dimensions but react-flow paints into 0 height.
    const canvas = page.locator('.topo__canvas')
    await expect(canvas).toBeVisible()
    const canvasBox = await canvas.boundingBox()
    expect(canvasBox?.height ?? 0).toBeGreaterThan(300)
    await expect(page.locator('.topo-node').first()).toBeVisible({
      timeout: 10_000,
    })

    expect(errors).toEqual([])
  })

  // Defensive: a typo'd / corrupted UUID in the URL must NOT 500. This was the
  // failure mode that surfaced PR-C/B validation gaps — a copy-paste with
  // stray %20 characters in the middle of the UUID crashed the page.
  test('malformed UUID in session URL returns 404, not 500', async ({ page }) => {
    const response = await page.goto(
      '/sessions/681de115-5de9-474e-9721-2%20%20%2063f65066e08',
    )
    // Either the framework's 404 status, or any non-500 with a graceful
    // not-found page — but never a 500 with the Drizzle "Failed query" text.
    expect(response?.status() ?? 0).toBeLessThan(500)
    await expect(page.getByText('Failed query', { exact: false })).toHaveCount(0)
  })
})
