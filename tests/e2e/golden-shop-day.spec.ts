import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { assertNoBrowserFaults, checkpoint, watchBrowserFaults } from './golden-browser-receipts'

type Role = 'owner' | 'advisor' | 'tech' | 'relief' | 'parts'
type Credential = { email: string; password: string }

const roles: Role[] = ['owner', 'advisor', 'tech', 'relief', 'parts']

function credential(role: Role): Credential {
  const prefix = `GOLDEN_QA_${role.toUpperCase()}`
  const email = process.env[`${prefix}_EMAIL`]
  const password = process.env[`${prefix}_PASSWORD`]
  if (!email || !password) throw new Error(`Missing ${prefix} browser credential`)
  return { email, password }
}

async function signedInPage(
  browser: Browser,
  baseURL: string,
  role: Role,
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
  const user = credential(role)
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

function ticketPath(page: Page): string {
  const pathname = new URL(page.url()).pathname
  if (!/^\/tickets\/[0-9a-f-]+$/i.test(pathname)) throw new Error('Repair order did not open')
  return pathname
}

async function openTicketFromToday(page: Page, ticketNumber: string): Promise<void> {
  await page.goto('/today')
  const row = page.getByRole('article', { name: new RegExp(`Repair order ${ticketNumber}:`) })
  await expect(row).toBeVisible()
  await row.getByRole('link', { name: new RegExp(`Open repair order ${ticketNumber}`) }).click()
  await page.waitForURL(/\/tickets\/[0-9a-f-]+$/)
}

// Two jobs on one repair order means Today carries two rows for the same ticket
// number and the quote workspace carries two of every per-job control. Naming
// the job in the locator is what keeps each step pointed at the line the shop
// is actually touching.
function boardRow(page: Page, ticketNumber: string, jobTitle: string) {
  return page.getByRole('article', { name: `Repair order ${ticketNumber}: ${jobTitle}` })
}

function quoteJobCard(page: Page, jobTitle: string) {
  return page.locator('li').filter({
    has: page.getByRole('heading', { name: jobTitle, exact: true }),
  }).first()
}

test('the living repair order survives one complete shop day', async ({ browser, baseURL }, testInfo) => {
  if (!baseURL) throw new Error('Golden browser base URL is required')
  const viewport = testInfo.project.use.viewport ?? { width: 1440, height: 900 }
  const mobile = testInfo.project.use.isMobile ?? false
  const sessions = new Map<Role, Awaited<ReturnType<typeof signedInPage>>>()
  const faults = []
  const runId = (process.env.GOLDEN_QA_RUN_ID ?? 'local').replace(/[^a-z0-9-]/gi, '').slice(0, 24)
  const customerName = `Golden QA ${runId}`
  const concern = [
    'Customer reports a repeating brake squeal during slow stops, most noticeable after a long highway drive,',
    'with intermittent vibration but no dashboard warning and no change in pedal height.',
    `Golden run ${runId}.`,
  ].join(' ')
  const laborDescription = [
    'Front brake inspection and pad replacement, including rotor measurement, hardware cleaning,',
    'lubrication, final torque verification, and road-test confirmation',
  ].join(' ')
  // The repair order carries two jobs: the brakes the customer approves and the
  // tires they turn down. The declined line is the one that used to jam the
  // repair order open forever.
  const brakeJobTitle = 'Inspect and repair the front brake concern'
  const tireJobTitle = 'Rotate and balance all four tires'
  const tireLaborDescription = [
    'Rotate all four tires, balance each wheel, torque the lug nuts to spec,',
    'and reset the tire pressure monitors',
  ].join(' ')

  try {
    for (const role of roles) {
      const session = await signedInPage(browser, baseURL, role, viewport, mobile)
      sessions.set(role, session)
      faults.push(watchBrowserFaults(session.page, role))
    }

    const owner = sessions.get('owner')!.page
    await expect(owner.getByText('Shop floor', { exact: true })).toBeVisible()
    await checkpoint(owner, testInfo, 'owner-today-empty')
    await owner.getByRole('link', { name: 'New repair order' }).click()
    await owner.getByLabel('Name', { exact: true }).fill(customerName)
    await owner.getByLabel('Phone').fill('5550100200')
    await owner.getByLabel('Year').fill('2021')
    await owner.getByLabel('Make').fill('Ford')
    await owner.getByLabel('Model').fill('F-150')
    await owner.getByLabel('Mileage today').first().fill('48120')
    await owner.getByLabel('What brought them in?').fill(concern)
    await owner.getByRole('button', { name: /^Perform known work/ }).click()
    await owner.getByLabel('Requested work').fill(brakeJobTitle)
    await checkpoint(owner, testInfo, 'owner-intake-complete')
    await owner.getByRole('button', { name: 'Create repair order' }).last().click()
    await owner.waitForURL(/\/tickets\/[0-9a-f-]+$/)
    const path = ticketPath(owner)
    const ticketNumber = (await owner.getByText(/^RO \d{6}$/).first().textContent())!.replace(/^RO 0*/, '')
    await expect(owner.getByRole('heading', { name: concern, exact: true })).toBeVisible()
    await expect(owner.getByText('Open — no technician assigned')).toBeVisible()
    await expect(owner.getByRole('button', { name: 'Build quote' }))
      .toHaveAttribute('aria-controls', /^inline-quote-workspace-/)
    await checkpoint(owner, testInfo, 'owner-created-ticket')

    await owner.goto('/today')
    const ownerTodayRow = owner.getByRole('article', { name: new RegExp(`Repair order ${ticketNumber}:`) })
    const assignmentResponsePromise = owner.waitForResponse((response) => (
      response.request().method() === 'POST'
      && /\/api\/tickets\/[0-9a-f-]+\/jobs\/[0-9a-f-]+\/assignment$/i.test(new URL(response.url()).pathname)
    ))
    await ownerTodayRow.getByRole('button', { name: 'Assign work' }).click()
    await owner.getByLabel('Choose technician').getByRole('button', { name: /Golden QA Technician/ }).click()
    expect((await assignmentResponsePromise).status(), 'in-place assignment API status').toBe(200)
    await expect(owner.getByRole('heading', { name: 'With the team' })).toBeVisible()
    await expect(owner.getByRole('article', { name: new RegExp(`Repair order ${ticketNumber}:`) }))
      .toContainText('Golden QA Technician')
    await expect(owner).toHaveURL(/\/today$/)

    const advisor = sessions.get('advisor')!.page
    await advisor.goto('/today')
    const advisorTodayRow = advisor.getByRole('article', { name: new RegExp(`Repair order ${ticketNumber}:`) })
    await checkpoint(advisor, testInfo, 'advisor-found-ticket')
    const quoteEntry = advisorTodayRow.getByRole('button', { name: 'Build quote' })
    await quoteEntry.click()
    const quoteWorkspace = advisor.getByRole('region', { name: 'Quote for this repair order' })
    await expect(quoteWorkspace).toBeFocused()
    await expect(quoteWorkspace).not.toHaveAttribute('aria-busy', { timeout: 30_000 })
    await expect(advisor.getByRole('heading', { name: 'Build quote' })).toBeVisible()
    await expect(advisor).toHaveURL(/\/today$/)
    await advisor.getByRole('button', { name: 'Add labor' }).click()
    const activeLabor = advisor.getByRole('button', { name: 'Adding labor' })
    await expect(activeLabor).toHaveAttribute('aria-expanded', 'true')
    await expect(activeLabor).toHaveAttribute('aria-controls', /^quote-line-editor-/)
    // Scope the fields to the labor editor: the write-up also carries the
    // supplemental "Diagnostic description"/"Diagnostic hours" inputs, which a
    // page-wide label lookup would match too.
    const laborEditor = advisor.getByRole('form', { name: 'Add labor line' })
    await expect(laborEditor).toBeInViewport()
    await laborEditor.getByLabel('Description').fill(laborDescription)
    await laborEditor.getByLabel('Hours').fill('1.5')
    await checkpoint(advisor, testInfo, 'advisor-local-labor-editor')

    advisor.once('dialog', (dialog) => dialog.accept())
    await advisor.reload()
    await advisor.getByRole('button', { name: 'Build quote' }).click()
    await expect(advisor.getByRole('status', { name: 'Quote update' }))
      .toHaveText('Unsaved labor restored')
    await expect(advisor.getByRole('form', { name: 'Add labor line' })).toBeInViewport()
    await expect(advisor.getByRole('form', { name: 'Add labor line' }).getByLabel('Description'))
      .toHaveValue(laborDescription)
    await advisor.getByRole('button', { name: 'Save line' }).click()
    const savedLabor = advisor.getByText(laborDescription, { exact: true })
    await expect(savedLabor).toBeVisible()
    await expect(advisor.getByRole('status', { name: 'Quote update' })).toHaveText('Labor added')
    await expect(savedLabor.locator('xpath=ancestor::li[1]')).toHaveAttribute('data-change-state', 'confirmed')
    await checkpoint(advisor, testInfo, 'advisor-quote-draft')

    // While the advisor has them on the phone the customer asks about the
    // tires, so a second job goes onto the same repair order and the same quote
    // version. One of these two is the one they are going to say no to.
    const addRepair = advisor.getByRole('region', { name: 'Add repair' })
    await addRepair.getByLabel('Work type').selectOption('maintenance')
    await addRepair.getByLabel('What are we doing').fill(tireJobTitle)
    const addJobResponsePromise = advisor.waitForResponse((response) => (
      response.request().method() === 'POST'
      && /\/api\/tickets\/[0-9a-f-]+\/quote\/jobs$/i.test(new URL(response.url()).pathname)
    ))
    await addRepair.getByRole('button', { name: 'Add repair' }).click()
    expect((await addJobResponsePromise).status(), 'second job API status').toBe(201)
    const tireJob = quoteJobCard(advisor, tireJobTitle)
    await expect(tireJob).toBeVisible()
    await tireJob.getByRole('button', { name: 'Add labor' }).click()
    const tireEditor = advisor.getByRole('form', { name: 'Add labor line' })
    await tireEditor.getByLabel('Description').fill(tireLaborDescription)
    await tireEditor.getByLabel('Hours').fill('1')
    await advisor.getByRole('button', { name: 'Save line' }).click()
    await expect(advisor.getByRole('status', { name: 'Quote update' })).toHaveText('Labor added')
    await expect(advisor.getByText(tireLaborDescription, { exact: true })).toBeVisible()
    await checkpoint(advisor, testInfo, 'advisor-quote-two-jobs')

    // The shop lines both jobs up for the same technician before the customer
    // answers. That is exactly how a refused line ends up sitting in a tech's
    // own queue with a green button on it.
    await owner.goto('/today')
    const tireAssignmentPromise = owner.waitForResponse((response) => (
      response.request().method() === 'POST'
      && /\/api\/tickets\/[0-9a-f-]+\/jobs\/[0-9a-f-]+\/assignment$/i.test(new URL(response.url()).pathname)
    ))
    await boardRow(owner, ticketNumber, tireJobTitle)
      .getByRole('button', { name: 'Assign work' }).click()
    await owner.getByLabel('Choose technician').getByRole('button', { name: /Golden QA Technician/ }).click()
    expect((await tireAssignmentPromise).status(), 'second job assignment API status').toBe(200)
    await expect(boardRow(owner, ticketNumber, tireJobTitle)).toContainText('Golden QA Technician')

    await advisor.getByRole('button', { name: 'Prepare quote' }).click()
    await expect(advisor.getByText(/Prepared version V1/)).toBeVisible()

    const quoteViewers: Array<{ role: Role; entry: string; canDecide: boolean }> = [
      { role: 'owner', entry: 'Record approval', canDecide: true },
      { role: 'tech', entry: 'View quote', canDecide: false },
      { role: 'relief', entry: 'View quote', canDecide: false },
      { role: 'parts', entry: 'View quote', canDecide: false },
    ]
    for (const viewer of quoteViewers) {
      const page = sessions.get(viewer.role)!.page
      await page.goto(path)
      await page.getByRole('button', { name: viewer.entry }).click()
      await expect(page.getByRole('heading', { name: 'Build quote' })).toBeVisible()
      // Both jobs carry their own authorization strip now, so the authority
      // check is read off one named strip rather than the whole workspace.
      if (viewer.canDecide) {
        await expect(page.getByRole('region', { name: `Authorization for ${brakeJobTitle}` })
          .getByRole('button', { name: 'Phone approval' })).toBeVisible()
      } else {
        await expect(page.getByRole('button', { name: 'Phone approval' })).toHaveCount(0)
        await expect(page.getByText('Advisor or owner records the customer decision.').first())
          .toBeVisible()
      }
      await checkpoint(page, testInfo, `${viewer.role}-quote-authority`)
      await page.getByRole('button', { name: 'Close quote' }).click()
    }

    const brakeAuthorization = advisor.getByRole('region', { name: `Authorization for ${brakeJobTitle}` })
    await brakeAuthorization.getByRole('button', { name: 'Defer decision' }).click()
    const deferral = advisor.getByRole('alertdialog', { name: 'Defer customer decision?' })
    await deferral.getByLabel('What are we waiting for?').fill('Customer is confirming the timing of the repair.')
    await deferral.getByRole('button', { name: 'Defer decision' }).click()
    await expect(brakeAuthorization.getByText('Deferred · follow up · V1')).toBeVisible()
    await expect(brakeAuthorization.getByRole('button', { name: 'Phone approval' })).toBeVisible()
    await checkpoint(advisor, testInfo, 'advisor-deferred-then-resumed-decision')

    await brakeAuthorization.getByRole('button', { name: 'Phone approval' }).click()
    const approval = advisor.getByRole('alertdialog', { name: 'Record phone approval?' })
    await approval.getByRole('button', { name: 'Record approval' }).click()
    await expect(brakeAuthorization.getByText('Approved · V1')).toBeVisible()

    // The customer says yes to the brakes and no to the tires. One immutable
    // version, two answers — which is the whole reason a single job has to be
    // retirable on its own.
    await advisor.getByRole('region', { name: `Authorization for ${tireJobTitle}` })
      .getByRole('button', { name: 'Record declined' }).click()
    const declineDialog = advisor.getByRole('alertdialog', { name: 'Record declined?' })
    await declineDialog.getByRole('button', { name: 'Record declined' }).click()

    await expect(advisor.getByRole('heading', { name: 'Quote complete' })).toBeVisible()
    const quoteProof = advisor.getByRole('region', { name: 'Quote', exact: true })
    await expect(quoteProof.getByRole('listitem').filter({ hasText: brakeJobTitle }))
      .toContainText('Approved · Version 1')
    await expect(quoteProof.getByRole('listitem').filter({ hasText: tireJobTitle }))
      .toContainText('Declined · Version 1')
    await checkpoint(advisor, testInfo, 'advisor-approved-one-declined-one')
    await advisor.getByRole('button', { name: 'Close quote' }).click()
    await expect(advisor.getByRole('button', { name: 'Record approval' })).toBeHidden()
    await expect(advisor).toHaveURL(/\/today$/)

    const tech = sessions.get('tech')!.page
    await tech.goto('/today')
    const techTodayRow = boardRow(tech, ticketNumber, brakeJobTitle)

    // The trap this closes: both lines are assigned to this tech, and the board
    // used to offer the same green "Open work" on the one the customer refused.
    // The row now states the customer's decision and sends the tech to the
    // paperwork instead of to the truck.
    const techDeclinedRow = boardRow(tech, ticketNumber, tireJobTitle)
    await expect(techDeclinedRow).toBeVisible()
    await expect(techDeclinedRow).toContainText('Declined')
    await expect(techDeclinedRow.getByText('Open work')).toHaveCount(0)
    await expect(techDeclinedRow.getByRole('link', { name: 'Review repair order' })).toBeVisible()
    await expect(techTodayRow).toContainText('Approved')
    await checkpoint(tech, testInfo, 'tech-board-declined-line-is-not-workable')

    const workResponsePromise = tech.waitForResponse((response) => (
      response.request().method() === 'GET'
      && /\/api\/tickets\/[0-9a-f-]+\/jobs\/[0-9a-f-]+\/work$/i.test(new URL(response.url()).pathname)
    ))
    await techTodayRow.getByRole('button', { name: 'Open work' }).click()
    const workResponse = await workResponsePromise
    expect(workResponse.status(), 'mounted work API status').toBe(200)
    await expect(tech.getByRole('heading', { name: 'Approved and ready' })).toBeVisible()
    await expect(tech.getByRole('heading', { name: 'Exactly what is approved' })).toBeVisible()
    await expect(tech.getByText(laborDescription, { exact: true })).toBeVisible()
    await expect(tech).toHaveURL(/\/today$/)
    const clockResponsePromise = tech.waitForResponse((response) => (
      response.request().method() === 'POST'
      && /\/api\/tickets\/[0-9a-f-]+\/jobs\/[0-9a-f-]+\/work$/i.test(new URL(response.url()).pathname)
    ))
    await tech.getByRole('button', { name: 'Clock on' }).click()
    expect((await clockResponsePromise).status(), 'clock-on API status').toBe(200)
    await expect(tech.getByRole('heading', { name: 'Work in progress' })).toBeVisible()
    const note = tech.getByRole('textbox', { name: 'Work note' })
    await note.fill('Confirmed pad wear, replaced front pads, torqued hardware, and completed a quiet road test.')
    await tech.reload()
    await expect(tech.getByRole('button', { name: 'Continue work' })).toBeVisible()
    await tech.getByRole('button', { name: 'Continue work' }).click()
    await expect(tech.getByRole('textbox', { name: 'Work note' })).toHaveValue(/Confirmed pad wear/)
    await tech.getByRole('button', { name: 'Close work' }).click()
    await expect(tech.getByRole('alert').filter({ hasText: 'Finish or clear the draft' })).toBeVisible()
    await expect(note).toHaveValue(/Confirmed pad wear/)
    const noteResponsePromise = tech.waitForResponse((response) => (
      response.request().method() === 'POST'
      && /\/api\/tickets\/[0-9a-f-]+\/jobs\/[0-9a-f-]+\/work$/i.test(new URL(response.url()).pathname)
    ))
    await tech.getByRole('button', { name: 'Save note' }).click()
    expect((await noteResponsePromise).status(), 'save-note API status').toBe(200)
    await expect(tech.getByRole('button', { name: 'Complete work' })).toBeEnabled()
    await tech.getByLabel('What part do you need?').fill('Front brake pad set')
    await tech.getByLabel('Brand or where to get it').fill('OE-equivalent')
    await tech.getByRole('button', { name: 'Send to parts' }).click()
    await expect(tech.getByLabel('Parts I need').getByText('Waiting on parts', { exact: true })).toBeVisible()
    await tech.locator('summary').filter({ hasText: 'Put work on hold' }).click()
    await tech.getByLabel('Reason for hold').selectOption('parts')
    await tech.getByLabel('What needs to happen next?').fill('Wait for the parts desk to source the pad set.')
    const holdForm = tech.getByLabel('Reason for hold').locator('xpath=ancestor::form')
    const holdSubmit = holdForm.getByRole('button', { name: 'Put work on hold', exact: true })
    await expect(holdSubmit).toBeEnabled()
    const holdResponsePromise = tech.waitForResponse((response) => (
      response.request().method() === 'POST'
      && /\/api\/tickets\/[0-9a-f-]+\/jobs\/[0-9a-f-]+\/interruption$/i.test(new URL(response.url()).pathname)
    ))
    await holdSubmit.click()
    expect((await holdResponsePromise).status(), 'put-work-on-hold API status').toBe(200)
    await expect(tech.getByRole('status').filter({ hasText: /Work on hold/ })).toBeVisible()
    await expect(techTodayRow.getByRole('button', { name: 'Resolve hold' })).toBeVisible()
    await expect(tech).toHaveURL(/\/today$/)
    await checkpoint(tech, testInfo, 'tech-work-and-part-request')

    await owner.goto(path)
    await owner.locator('summary').filter({ hasText: 'Cancel repair order' }).click()
    await owner.getByLabel('Cancellation reason').fill('Customer asked us to pause while they confirm the repair timing.')
    await owner.getByRole('button', { name: 'Cancel repair order' }).click()
    await expect(owner.getByText('Canceled · Written up', { exact: true })).toBeVisible()
    await owner.getByRole('button', { name: 'Reopen repair order' }).click()
    await expect(owner.getByText('Open · Written up', { exact: true })).toBeVisible()
    // The work stamp on the brake job. It used to print the column and its
    // value ("Work · Blocked"); it now says what the shop says.
    await expect(
      owner.getByRole('listitem')
        .filter({ has: owner.getByRole('heading', { name: brakeJobTitle, exact: true }) })
        .getByText('On hold', { exact: true }),
    ).toBeVisible()
    await checkpoint(owner, testInfo, 'owner-cancel-reopen-blocked-work')

    await advisor.goto('/today')
    const advisorHandoffRow = boardRow(advisor, ticketNumber, brakeJobTitle)
    await advisorHandoffRow.getByRole('button', { name: 'Hand off' }).click()
    await advisor.getByLabel('Choose technician').getByRole('button', { name: /Golden QA Relief Technician/ }).click()
    await expect(advisor.getByRole('status').filter({ hasText: /assigned to Golden QA Relief Technician/i })).toBeVisible()
    await checkpoint(advisor, testInfo, 'advisor-handoff-relief-tech')

    const parts = sessions.get('parts')!.page
    await parts.goto('/today')
    await expect(parts.getByRole('heading', { name: 'Parts needed' })).toBeVisible()
    await checkpoint(parts, testInfo, 'parts-queue')
    const partsTodayRow = boardRow(parts, ticketNumber, brakeJobTitle)
    await partsTodayRow.getByRole('button', { name: 'Got it' }).click()
    await expect(parts.getByRole('status').filter({ hasText: /Parts found/ })).toBeVisible()
    await expect(boardRow(parts, ticketNumber, brakeJobTitle)).toHaveCount(0)
    await expect(parts).toHaveURL(/\/today$/)

    const relief = sessions.get('relief')!.page
    await relief.goto('/today')
    const reliefTodayRow = boardRow(relief, ticketNumber, brakeJobTitle)
    await expect(reliefTodayRow.getByRole('button', { name: 'Resolve hold' })).toBeVisible()
    await reliefTodayRow.getByRole('button', { name: 'Resolve hold' }).click()
    await expect(relief.getByRole('status').filter({ hasText: /Hold resolved/ })).toBeVisible()
    await reliefTodayRow.getByRole('button', { name: 'Continue work' }).click()
    await expect(relief.getByRole('heading', { name: 'Work in progress' })).toBeVisible()
    const completionResponsePromise = relief.waitForResponse((response) => (
      response.request().method() === 'POST'
      && /\/api\/tickets\/[0-9a-f-]+\/jobs\/[0-9a-f-]+\/work$/i.test(new URL(response.url()).pathname)
    ))
    await relief.getByRole('button', { name: 'Complete work' }).click()
    expect((await completionResponsePromise).status(), 'relief completion API status').toBe(200)
    await expect(relief.getByRole('heading', { name: 'Work complete' })).toBeVisible()
    await relief.getByRole('button', { name: 'Close work' }).click()
    await expect(boardRow(relief, ticketNumber, brakeJobTitle)).toHaveCount(0)
    await expect(relief.getByRole('heading', { name: 'Ready to collect' })).toHaveCount(0)
    await checkpoint(relief, testInfo, 'relief-complete-ticket')

    // The approved repair is finished and the shop is owed money, but the
    // declined line is still live work, so the counter's Ready-to-collect lane
    // does not carry this repair order at all. That is the jam, at the board.
    await advisor.goto('/today')
    const collectCard = advisor.getByRole('article', {
      name: `Repair order ${ticketNumber}: ready to collect`,
    })
    await expect(collectCard).toHaveCount(0)
    await checkpoint(advisor, testInfo, 'advisor-declined-line-holds-the-counter')

    // The repair order itself still rings out, and the bill is only what the
    // customer said yes to: 1.5 hours of labor at $120/hr, untaxed. The
    // declined line's $120 of labor is not on it, so the balance is exactly
    // what it would have been without the second job.
    await advisor.goto(path)
    const ringOut = advisor.getByRole('region', { name: 'The bill' })
    await expect(ringOut).toContainText(brakeJobTitle)
    await expect(ringOut.getByText(tireJobTitle)).toHaveCount(0)
    await expect(ringOut.getByText('$120.00')).toHaveCount(0)
    await expect(ringOut).toContainText('$180.00')
    await advisor.getByLabel('Payment amount').fill('180.00')
    await advisor.getByLabel('How paid').selectOption('card')
    // Review the mounted tool while it is actionable. Checkpointing after the
    // click instead would audit whatever transient busy state the request
    // happened to be in.
    await checkpoint(advisor, testInfo, 'advisor-ring-out-on-the-repair-order')
    const paymentResponsePromise = advisor.waitForResponse((response) => (
      response.request().method() === 'POST'
      && /\/api\/tickets\/[0-9a-f-]+\/payments$/i.test(new URL(response.url()).pathname)
    ))
    await advisor.getByRole('button', { name: 'Record payment' }).click()
    expect((await paymentResponsePromise).status(), 'in-place payment API status').toBe(200)

    // Paid in full and it still refuses to close, because a declined line is
    // open work. Whole-ticket cancel is no way out either — a payment exists.
    // This is the wall the shop hit, and it had no door until this branch.
    const closeButton = advisor.getByRole('button', { name: 'Mark paid and close' })
    await expect(closeButton).toBeEnabled()
    await closeButton.click()
    await expect(ringOut.getByRole('alert'))
      .toHaveText('Finish every job, or drop the ones you are not doing, before closing this repair order.')
    await expect(advisor.getByText('Closed · Written up', { exact: true })).toHaveCount(0)
    await checkpoint(advisor, testInfo, 'advisor-close-blocked-by-declined-line')

    // Retiring the line is the counter acting on the decision it already
    // recorded — one job, not the whole repair order, with the money already
    // collected.
    await advisor.getByRole('button', { name: 'Not doing this one' }).click()
    await expect(advisor.getByText('Dropped. This job was declined.')).toBeVisible()
    await checkpoint(advisor, testInfo, 'advisor-retired-declined-line')

    // With the refused line off the floor the repair order finally reaches the
    // counter lane — paid in full — and closes in place.
    await advisor.goto('/today')
    await expect(advisor.getByRole('heading', { name: 'Ready to collect' })).toBeVisible()
    await expect(collectCard).toContainText('Work complete')
    await expect(collectCard).toContainText('Paid in full')
    await checkpoint(advisor, testInfo, 'advisor-ready-to-collect')
    await collectCard.getByRole('button', { name: 'Close repair order' }).click()
    await expect(advisor.getByRole('region', { name: 'The bill' })).toBeFocused()
    // Named, enabled, and no longer "Closing…": the payment landed and the
    // balance it reported is zero.
    const boardCloseButton = advisor.getByRole('button', { name: 'Mark paid and close' })
    await expect(boardCloseButton).toBeEnabled()
    await boardCloseButton.click()
    await expect(advisor.getByRole('status').filter({
      hasText: `Repair order ${ticketNumber} is closed and off the board.`,
    })).toBeVisible()
    await expect(collectCard).toHaveCount(0)
    await expect(advisor).toHaveURL(/\/today$/)
    await checkpoint(advisor, testInfo, 'advisor-closed-ticket')

    await owner.goto(path)
    await expect(owner.getByText('Closed · Written up', { exact: true })).toBeVisible()
    await expect(owner.getByRole('heading', { name: 'Receipt' })).toBeVisible()
    await owner.goto('/today')
    await expect(owner.getByRole('article', { name: new RegExp(`Repair order ${ticketNumber}:`) })).toHaveCount(0)
    await checkpoint(owner, testInfo, 'owner-closed-day')

    // Off the board is where a closed repair order used to leave the product
    // entirely — no list, no search, no way back but a deep link somebody
    // already had. The lookup is the door back: found by the number on the
    // paperwork, opened in place of a second write-up on a new number.
    await owner.getByLabel('Find a repair order').fill(`RO ${ticketNumber}`)
    const foundClosed = owner.getByRole('link', { name: new RegExp(`RO ${ticketNumber}\\b`) })
    await expect(foundClosed).toBeVisible()
    await expect(foundClosed).toContainText('Closed')
    await checkpoint(owner, testInfo, 'owner-closed-repair-order-found')
    await foundClosed.click()
    await owner.waitForURL(new RegExp(`${path}$`))
    await expect(owner.getByRole('heading', { name: 'Receipt' })).toBeVisible()
    assertNoBrowserFaults(faults)
  } finally {
    await Promise.race([
      Promise.allSettled(Array.from(sessions.values()).map((session) => session.context.close())),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ])
    if (browser.isConnected()) {
      await Promise.race([
        browser.close(),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ])
    }
  }
})
