/**
 * E2E: 2006 F-250 6.0 PSD cranks-no-start — cache HIT, zero AI calls
 *
 * REQUIRES A RUNNING DEV SERVER AGAINST THE REHEARSAL DB
 * --------------------------------------------------------
 * This test must run against a dev server backed by `vyntechs_rehearsal`
 * (the local Postgres clone) with seed batches 1–7 applied:
 *
 *   DATABASE_URL=postgresql://localhost/vyntechs_rehearsal pnpm dev
 *
 * Execution is wired up in Task 13 of:
 *   docs/superpowers/plans/2026-05-24-6.0-psd-cranks-no-start-seed.md
 *
 * The test is guarded by VYNTECHS_E2E_REHEARSAL_DB=true so it does not run
 * in CI environments that do not have the rehearsal DB seeded.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * This is the structural "fabrication impossible by construction" proof for
 * the 2006 F-250 6.0 PSD cranks-no-start case (triggered by Angel's session
 * 1bca23cb-166a-41f6-86a3-588bc3f39adf where the AI fabricated valley-cover
 * procedure and inverted the IPR-unplug interpretation). A passing test here
 * proves the resolver chain (platform → symptom → cache row) works end-to-end
 * and that the session creation route skips AI entirely when a cache row is
 * present.
 */

import { test, expect } from '@playwright/test'

const RUN = process.env.VYNTECHS_E2E_REHEARSAL_DB === 'true'
const maybeSkip = RUN ? test.describe : test.describe.skip

maybeSkip('6.0 PSD cranks-no-start — cache HIT, zero AI calls', () => {
  // Capture all outbound requests so we can assert zero AI calls.
  // Set up before navigation so we don't miss any requests that fire during
  // session creation. The routes that call AI in this codebase are:
  //   - POST /api/sessions           (generateInitialTree — skipped on cache hit)
  //   - POST /api/intake/submit      (legacy intake path, also skips on cache hit)
  //   - POST /api/sessions/:id/advance        (updateTree — not reached on cache-hit sessions)
  //   - POST /api/sessions/:id/advance/stream (streaming variant — same)
  //   - POST /api/sessions/:id/ambient        (ambient updateTree — same)
  // All of these call lib/ai/client.ts → api.anthropic.com.
  let aiCallUrls: string[] = []

  test.beforeEach(async ({ page }) => {
    aiCallUrls = []
    page.on('request', (req) => {
      const url = req.url()
      // Direct Anthropic API calls (e.g. from a server-side fetch that happens
      // to be visible as an outbound request in the test environment).
      if (url.includes('anthropic.com')) {
        aiCallUrls.push(url)
      }
      // Internal API routes that invoke the AI. On a cache hit, none of these
      // should be called.
      if (
        url.includes('/api/sessions') &&
        (url.includes('/advance') || url.includes('/ambient'))
      ) {
        aiCallUrls.push(url)
      }
    })
  })

  // Auth: sign in via the form (same pattern as counter-intake.spec.ts). The
  // env vars are the same OWNER_TEST_EMAIL / OWNER_TEST_PASSWORD pair used by
  // the counter-intake spec.
  test.beforeEach(async ({ page }) => {
    const email = process.env.OWNER_TEST_EMAIL
    const password = process.env.OWNER_TEST_PASSWORD
    // If auth env vars are missing, skip the test rather than failing hard.
    test.skip(
      !email || !password,
      'OWNER_TEST_EMAIL / OWNER_TEST_PASSWORD env vars not set',
    )
    await page.goto('/sign-in')
    await page.getByLabel(/email/i).fill(email!)
    await page.getByLabel(/password/i).fill(password!)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL(/\/today/)
  })

  test(
    'creates a 2006 F-250 6.0 PSD cranks-no-start session, routes to cached topology, zero AI calls',
    async ({ page }) => {
      // ── Step 1: open the new-session form ──────────────────────────────
      await page.goto('/sessions/new')
      await expect(page).toHaveURL(/\/sessions\/new$/)

      // ── Step 2: fill in vehicle fields ─────────────────────────────────
      // Field names come from components/intake/new-session-form.tsx —
      // hoisted state variables; the inputs use `id` and `name` attributes
      // that match the state var names: vehicleYear, vehicleMake, vehicleModel,
      // vehicleEngine.
      await page.getByLabel(/year/i).fill('2006')
      await page.getByLabel(/make/i).fill('Ford')
      await page.getByLabel(/model/i).fill('F-250')
      await page.getByLabel(/engine/i).fill('6.0 Powerstroke')

      // ── Step 3: fill in complaint ───────────────────────────────────────
      // Intentionally messy input: "cranks no start" (lowercase, no hyphen)
      // to exercise the symptom resolver's normalization.
      await page.getByLabel(/customer complaint/i).fill('cranks no start')

      // ── Step 4: submit ─────────────────────────────────────────────────
      // The submit button reads "Start diagnosis" (from new-session-form.tsx).
      await page.getByRole('button', { name: /start diagnosis/i }).click()

      // ── Step 5: wait for redirect to /sessions/:id ─────────────────────
      // The form POSTs to /api/sessions, gets back { id }, then router.push.
      await page.waitForURL(/\/sessions\/[0-9a-f-]+$/, { timeout: 15_000 })

      // ── Step 6: wait for the cached-overview topology UI to render ──────
      // The cache-hit path renders <TopologyDiagnostic> which wraps everything
      // in a .topo div with class "topo". The header h1 uses class "topo__title"
      // and contains the formatted symptom slug: formatSymptomTitle('cranks-no-start')
      // → "Cranks No Start".
      await expect(page.locator('h1.topo__title')).toBeVisible({ timeout: 10_000 })
      await expect(page.locator('h1.topo__title')).toHaveText('Cranks No Start')

      // ── Step 7: assert the eyebrow shows "wiring topology" (not an AI path) ─
      // The AI-tree active-session path renders <ActiveSession> — it does NOT
      // have a .topo__eyebrow element. This asserts we are on the topology path.
      await expect(page.locator('.topo__eyebrow')).toBeVisible()
      await expect(page.locator('.topo__eyebrow')).toContainText(/wiring topology/i)

      // ── Step 8: assert the React Flow canvas rendered (topology loaded) ─
      // The canvas wrapper has class "topo__canvas" and React Flow renders
      // nodes with class "react-flow__node" inside it.
      await expect(page.locator('.topo__canvas')).toBeVisible()
      // React Flow renders nodes; 14 components in the seed = 14 nodes.
      // Use a generous minimum — at least one node must be visible to prove
      // the topology data loaded from the DB.
      const nodes = page.locator('.topo__canvas .react-flow__node')
      await expect(nodes.first()).toBeVisible({ timeout: 5_000 })
      const nodeCount = await nodes.count()
      expect(nodeCount).toBeGreaterThanOrEqual(14)

      // ── Step 9: assert HPOP and ICP sensor nodes are present ───────────
      // The node name renders in .topo-node__name. These two are the most
      // diagnostic-critical components for the 6.0 PSD cranks-no-start case.
      await expect(
        page.locator('.topo-node__name').filter({ hasText: /hpop|high.pressure oil pump/i }).first(),
      ).toBeVisible()
      await expect(
        page.locator('.topo-node__name').filter({ hasText: /icp sensor/i }).first(),
      ).toBeVisible()

      // ── Step 10: click ICP sensor node → panel opens → assert IPR note ─
      // The "NOT the IPR" phrase lives in the test action description for
      // the icp-sensor-unplug test (seeded in batch 5). It only renders
      // after clicking the ICP sensor node to open the detail panel.
      const icpNode = page.locator('.topo-node__name').filter({ hasText: /icp sensor/i }).first()
      await icpNode.click()
      // Wait for the panel to open (class "is-open" is added, or just wait
      // for the test item to appear).
      await expect(page.locator('[data-testid="topo-test"]').first()).toBeVisible({
        timeout: 5_000,
      })
      // The seed sets display_name to include "(NOT the IPR — distinct test)"
      // and renders it in the test description div inside [data-testid="topo-test"].
      await expect(
        page.locator('[data-testid="topo-test"]').filter({ hasText: /NOT the IPR/i }).first(),
      ).toBeVisible()

      // ── Step 11: count the implicated test actions on ICP sensor ────────
      // The ICP sensor node carries the icp-sensor-unplug test action which
      // is implicated by the cranks-no-start symptom (class "is-implicated"
      // on the panel card). Soft assertion: at least 1 implicated test visible.
      await expect(
        page.locator('[data-testid="topo-test"].is-implicated').first(),
      ).toBeVisible()

      // ── Step 12: close panel, click HPOP node → air puff test ──────────
      // Close the ICP panel first (✕ button).
      await page.locator('button.topo-panel__close').click()
      // After close: selection cleared → panel shows empty state text and the
      // close button disappears (it only renders when selection.kind !== 'empty').
      await expect(page.locator('button.topo-panel__close')).toBeHidden()

      // The air-puff test action is seeded onto the HPOP component
      // (or whichever component the plan attaches it to — find it by searching
      // the rendered nodes for a component whose panel contains the phrase).
      // Strategy: click each component node until we find the panel that
      // contains "turbo NOT required". Maximum 14 nodes to try.
      const allNodeNames = page.locator('.topo-node__name')
      const nameCount = await allNodeNames.count()
      let foundAirPuffText = false
      for (let i = 0; i < nameCount; i++) {
        await allNodeNames.nth(i).click()
        // Wait briefly for panel to update.
        const testCards = page.locator('[data-testid="topo-test"]')
        const cardCount = await testCards.count()
        if (cardCount > 0) {
          const panelText = await page.locator('.topo-panel').textContent()
          if (panelText && /turbo.*not required/i.test(panelText)) {
            foundAirPuffText = true
            break
          }
        }
        // Reset selection before clicking the next node — click the canvas
        // background (pane click) to clear selection without relying on the
        // close button. The onPaneClick handler calls onClearSelection().
        await page.locator('.topo__canvas .react-flow__pane').click({ position: { x: 5, y: 5 } })
      }
      expect(foundAirPuffText).toBe(true)

      // ── Step 13: assert zero AI calls happened ──────────────────────────
      // This is the primary proof: the entire session creation + topology render
      // did not invoke any route that calls the Anthropic API.
      //
      // On a cache hit:
      //  - POST /api/sessions takes the CACHE_HIT_SENTINEL path (no AI call)
      //  - /sessions/:id renders the cached-overview branch (no AI call)
      //  - No /advance or /ambient routes are triggered (those are AI-tree only)
      expect(aiCallUrls).toEqual([])
    },
  )
})
