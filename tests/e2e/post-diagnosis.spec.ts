import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { assertNoBrowserFaults, watchBrowserFaults } from './golden-browser-receipts'

/**
 * The other half of the repair order: what happens AFTER the diagnosis.
 *
 * The counter authorizes diagnostic labor, the shop finds the cause, and then
 * it has to write the findings the customer reads and add the repair it just
 * found — neither of which existed before PR #216. The shop under test has the
 * diagnostics add-on off, which is the shape every production shop has today
 * and the exact shape that used to close the loop: no session ever arrives to
 * write a first story, so the manual editor has to be offered from the start.
 */

type Credential = { email: string; password: string }

function credential(role: 'owner'): Credential {
  const prefix = `GOLDEN_QA_${role.toUpperCase()}`
  const email = process.env[`${prefix}_EMAIL`]
  const password = process.env[`${prefix}_PASSWORD`]
  if (!email || !password) throw new Error(`Missing ${prefix} browser credential`)
  return { email, password }
}

async function signedInPage(
  browser: Browser,
  baseURL: string,
  viewport: { width: number; height: number },
  mobile: boolean,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL,
    viewport,
    screen: viewport,
    deviceScaleFactor: 1,
    hasTouch: mobile,
    isMobile: mobile,
  })
  const page = await context.newPage()
  const user = credential('owner')
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL(/\/today$/)
  const legalNotice = page.getByLabel('Terms and Privacy update')
  if (await legalNotice.isVisible()) {
    await legalNotice.getByRole('button', { name: 'Dismiss legal update notice' }).click()
    await expect(legalNotice).toBeHidden()
  }
  return { context, page }
}

test('the shop finishes the repair order after the diagnosis', async ({ browser, baseURL }, testInfo) => {
  if (!baseURL) throw new Error('Golden browser base URL is required')
  const viewport = testInfo.project.use.viewport ?? { width: 1440, height: 900 }
  const mobile = testInfo.project.use.isMobile ?? false
  const runId = (process.env.GOLDEN_QA_RUN_ID ?? 'local').replace(/[^a-z0-9-]/gi, '').slice(0, 24)
  const customerName = `Post Diagnosis QA ${runId}`
  const concern = [
    'Customer states the engine ticks when cold and sometimes stays ticking once it is warm,',
    'with no warning light on the dash and no change in how it drives.',
    `Post-diagnosis run ${runId}.`,
  ].join(' ')
  const diagnosticTitle = 'Diagnose engine ticking noise'
  const repairTitle = 'Replace failed exhaust manifold bolts and gasket'
  const whatWeFound = [
    'Ticking traced to two broken exhaust manifold bolts on the right bank.',
    'The manifold is lifting off the head under load and leaking at the gasket.',
  ].join(' ')
  const whatWeRecommend = [
    'Extract the broken bolts, replace the manifold gasket and all fasteners,',
    'then re-torque and road test to confirm the noise is gone.',
  ].join(' ')

  let session: Awaited<ReturnType<typeof signedInPage>> | null = null
  try {
    session = await signedInPage(browser, baseURL, viewport, mobile)
    const owner = session.page
    const faults = [watchBrowserFaults(owner, 'owner')]

    // 1. The counter writes it up as a diagnosis: the customer's own words, and
    //    the diagnostic labor the customer is authorizing.
    await owner.getByRole('link', { name: 'New work order' }).click()
    await owner.getByLabel('Name', { exact: true }).fill(customerName)
    await owner.getByLabel('Phone').fill('5550100300')
    await owner.getByLabel('Year').fill('2021')
    await owner.getByLabel('Make').fill('Ram')
    await owner.getByLabel('Model').fill('2500')
    await owner.getByLabel('Mileage today').first().fill('61230')
    await owner.getByLabel('What brought them in?').fill(concern)
    await owner.getByRole('button', { name: /^Find the cause/ }).click()
    // A shop with saved diagnostics picks one; this shop types the scope. Both
    // land on the same typed fields via the picker's last option.
    const diagnosticTemplate = owner.locator('#ci-diagnostic-template')
    if (await diagnosticTemplate.count()) await diagnosticTemplate.selectOption('custom')
    await owner.locator('#ci-diag-description').fill(diagnosticTitle)
    await owner.locator('#ci-diag-hours').fill('1')
    await owner.locator('#ci-diag-price').fill('155.00')
    await owner.getByRole('button', { name: 'Create repair order' }).last().click()
    await owner.waitForURL(/\/tickets\/[0-9a-f-]+$/)
    await expect(owner.getByRole('heading', { name: concern, exact: true })).toBeVisible()

    // 2. Build quote opens on a repair order carrying only diagnostic labor —
    //    the state the owner reported as "only lets me add more diagnostics".
    await owner.getByRole('button', { name: 'Build quote' }).click()
    const workspace = owner.getByRole('region', { name: 'Inline quote workspace' })
    await expect(workspace).not.toHaveAttribute('aria-busy', { timeout: 30_000 })
    await expect(owner.getByRole('heading', { name: 'Build quote' })).toBeVisible()

    // 3. The findings editor is reachable with no story and no session. This is
    //    the closed loop: before the fix this job rendered a dead sentence.
    const story = owner.getByRole('region', { name: `Diagnostic story for ${diagnosticTitle}` })
    await expect(story).toBeVisible()
    await expect(story.getByRole('heading', { name: 'Recorded findings' })).toBeVisible()
    await expect(story.getByText('Diagnostic labor only.')).toHaveCount(0)
    await story.getByLabel('What we found').fill(whatWeFound)
    await story.getByLabel('What we recommend').fill(whatWeRecommend)
    await story.getByRole('button', { name: 'Review and save story' }).click()
    await expect(story.getByRole('status')).toHaveText('Reviewed customer story')

    // 4. The repair the shop just found goes onto the same repair order without
    //    a saved template.
    const addRepair = owner.getByRole('region', { name: 'Add repair' })
    await addRepair.getByLabel('Work type').selectOption('repair')
    await addRepair.getByLabel('What are we doing').fill(repairTitle)
    const addResponse = owner.waitForResponse((response) => (
      response.request().method() === 'POST'
      && /\/api\/tickets\/[0-9a-f-]+\/quote\/jobs$/i.test(new URL(response.url()).pathname)
    ))
    await addRepair.getByRole('button', { name: 'Add repair' }).click()
    expect((await addResponse).status(), 'add ad-hoc repair API status').toBe(201)
    const repairJob = owner.locator('li').filter({
      has: owner.getByRole('heading', { name: repairTitle, exact: true }),
    }).first()
    await expect(repairJob).toBeVisible()

    // 5. It prices with the same line editor every other job uses.
    await repairJob.getByRole('button', { name: 'Add labor' }).click()
    const laborEditor = owner.getByRole('form', { name: 'Add labor line' })
    await laborEditor.getByLabel('Description').fill('Extract broken manifold bolts and replace the gasket')
    await laborEditor.getByLabel('Hours').fill('3')
    await owner.getByRole('button', { name: 'Save line' }).click()
    await expect(owner.getByRole('status', { name: 'Quote update' })).toHaveText('Labor added')

    // 6. Findings written and repair priced, the whole repair order goes to the
    //    customer for approval as one version.
    await owner.getByRole('button', { name: 'Prepare quote' }).click()
    await expect(owner.getByText(/Prepared version V1/)).toBeVisible()
    // The diagnosis and the repair it found are two authorizations on one
    // immutable version, so the customer decides on each. The workspace
    // collapses into its recorded proof once the last one is decided, which is
    // why only the first decision is read back from its own strip.
    async function approve(jobTitle: string): Promise<void> {
      await owner.getByRole('region', { name: `Authorization for ${jobTitle}` })
        .getByRole('button', { name: 'Phone approval' }).click()
      const approval = owner.getByRole('alertdialog', { name: 'Record phone approval?' })
      await approval.getByRole('button', { name: 'Record approval' }).click()
    }
    await approve(diagnosticTitle)
    await expect(owner.getByRole('region', { name: `Authorization for ${diagnosticTitle}` })
      .getByText('Approved · V1')).toBeVisible()
    await approve(repairTitle)
    const complete = owner.getByRole('region', { name: 'Quote workspace', exact: true })
    await expect(complete.getByRole('heading', { name: 'Quote complete' })).toBeVisible()
    await expect(complete.getByRole('listitem').filter({ hasText: diagnosticTitle }))
      .toContainText('Approved · Version 1')
    await expect(complete.getByRole('listitem').filter({ hasText: repairTitle }))
      .toContainText('Approved · Version 1')
    await expect(complete).toContainText('$543.80')

    assertNoBrowserFaults(faults)
  } finally {
    if (session) {
      await Promise.race([
        session.context.close(),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ])
    }
    if (browser.isConnected()) {
      await Promise.race([
        browser.close(),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ])
    }
  }
})
