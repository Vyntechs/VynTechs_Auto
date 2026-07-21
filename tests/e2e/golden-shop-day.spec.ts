import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { assertNoBrowserFaults, checkpoint, watchBrowserFaults } from './golden-browser-receipts'

type Role = 'owner' | 'advisor' | 'tech' | 'parts'
type Credential = { email: string; password: string }

const roles: Role[] = ['owner', 'advisor', 'tech', 'parts']

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
  const row = page.getByRole('article', { name: new RegExp(`Ticket ${ticketNumber}:`) })
  await expect(row).toBeVisible()
  await row.getByRole('link', { name: new RegExp(`Open ticket ${ticketNumber}`) }).click()
  await page.waitForURL(/\/tickets\/[0-9a-f-]+$/)
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

  try {
    for (const role of roles) {
      const session = await signedInPage(browser, baseURL, role, viewport, mobile)
      sessions.set(role, session)
      faults.push(watchBrowserFaults(session.page))
    }

    const owner = sessions.get('owner')!.page
    await expect(owner.getByText('Shop floor', { exact: true })).toBeVisible()
    await checkpoint(owner, testInfo, 'owner-today-empty')
    await owner.getByRole('link', { name: 'New work order' }).click()
    await owner.getByLabel('Name', { exact: true }).fill(customerName)
    await owner.getByLabel('Phone').fill('5550100200')
    await owner.getByLabel('Year').fill('2021')
    await owner.getByLabel('Make').fill('Ford')
    await owner.getByLabel('Model').fill('F-150')
    await owner.getByLabel('Mileage today').first().fill('48120')
    await owner.getByLabel('What brought them in?').fill(concern)
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

    await owner.getByRole('button', { name: 'Assign work' }).click()
    await owner.getByLabel('Choose technician').getByRole('button', { name: /Golden QA Technician/ }).click()
    await expect(owner.getByRole('status').filter({ hasText: /Assigned to Golden QA Technician/ })).toBeVisible()
    await expect(owner).toHaveURL(new RegExp(`${path}$`))

    const advisor = sessions.get('advisor')!.page
    await openTicketFromToday(advisor, ticketNumber)
    await checkpoint(advisor, testInfo, 'advisor-found-ticket')
    const quoteEntry = advisor.getByRole('button', { name: 'Build quote' })
    await expect(quoteEntry).toHaveAttribute('aria-controls', /^inline-quote-workspace-/)
    await quoteEntry.click()
    const quoteWorkspace = advisor.getByRole('region', { name: 'Inline quote workspace' })
    await expect(quoteWorkspace).toBeFocused()
    await expect(advisor.getByRole('heading', { name: 'Build quote' })).toBeVisible()
    await expect(advisor).toHaveURL(new RegExp(`${path}$`))
    await advisor.getByLabel('What we found').fill('Front brake pad wear indicators contact the rotors at low speed.')
    await advisor.getByLabel('What we recommend').fill('Replace the front brake pads and inspect rotor thickness before installation.')
    await advisor.getByRole('button', { name: 'Review and save story' }).click()
    await expect(advisor.getByText('Reviewed customer story')).toBeVisible()
    await advisor.getByRole('button', { name: 'Add labor' }).click()
    const activeLabor = advisor.getByRole('button', { name: 'Adding labor' })
    await expect(activeLabor).toHaveAttribute('aria-expanded', 'true')
    await expect(activeLabor).toHaveAttribute('aria-controls', /^quote-line-editor-/)
    await expect(advisor.getByRole('form', { name: 'Add labor line' })).toBeInViewport()
    await advisor.getByLabel('Description').fill(laborDescription)
    await advisor.getByLabel('Hours').fill('1.5')
    await checkpoint(advisor, testInfo, 'advisor-local-labor-editor')

    advisor.once('dialog', (dialog) => dialog.accept())
    await advisor.reload()
    await advisor.getByRole('button', { name: 'Build quote' }).click()
    await expect(advisor.getByRole('status', { name: 'Quote update' }))
      .toHaveText('Unsaved labor restored')
    await expect(advisor.getByRole('form', { name: 'Add labor line' })).toBeInViewport()
    await expect(advisor.getByLabel('Description')).toHaveValue(laborDescription)
    await advisor.getByRole('button', { name: 'Save line' }).click()
    const savedLabor = advisor.getByText(laborDescription, { exact: true })
    await expect(savedLabor).toBeVisible()
    await expect(advisor.getByRole('status', { name: 'Quote update' })).toHaveText('Labor added')
    await expect(savedLabor.locator('xpath=ancestor::li[1]')).toHaveAttribute('data-change-state', 'confirmed')
    await checkpoint(advisor, testInfo, 'advisor-quote-draft')
    await advisor.getByRole('button', { name: 'Prepare quote' }).click()
    await expect(advisor.getByText(/Prepared version V1/)).toBeVisible()

    const quoteViewers: Array<{ role: Role; entry: string; canDecide: boolean }> = [
      { role: 'owner', entry: 'Record approval', canDecide: true },
      { role: 'tech', entry: 'View quote', canDecide: false },
      { role: 'parts', entry: 'View quote', canDecide: false },
    ]
    for (const viewer of quoteViewers) {
      const page = sessions.get(viewer.role)!.page
      await page.goto(path)
      await page.getByRole('button', { name: viewer.entry }).click()
      await expect(page.getByRole('heading', { name: 'Build quote' })).toBeVisible()
      if (viewer.canDecide) {
        await expect(page.getByRole('button', { name: 'Phone approval' })).toBeVisible()
      } else {
        await expect(page.getByRole('button', { name: 'Phone approval' })).toHaveCount(0)
        await expect(page.getByText('Advisor or owner records the customer decision.')).toBeVisible()
      }
      await checkpoint(page, testInfo, `${viewer.role}-quote-authority`)
      await page.getByRole('button', { name: 'Close quote' }).click()
    }

    await advisor.getByRole('button', { name: 'Phone approval' }).click()
    const approval = advisor.getByRole('alertdialog', { name: 'Record phone approval?' })
    await approval.getByRole('button', { name: 'Record approval' }).click()
    await expect(advisor.getByRole('heading', { name: 'Quote complete' })).toBeVisible()
    await expect(advisor.getByText('Approved · Version 1')).toBeVisible()
    await advisor.getByRole('button', { name: 'Close quote' }).click()
    await expect(advisor.getByRole('button', { name: 'Record approval' })).toBeHidden()
    await expect(advisor).toHaveURL(new RegExp(`${path}$`))

    const tech = sessions.get('tech')!.page
    await openTicketFromToday(tech, ticketNumber)
    const workResponsePromise = tech.waitForResponse((response) => (
      response.request().method() === 'GET'
      && /\/api\/tickets\/[0-9a-f-]+\/jobs\/[0-9a-f-]+\/work$/i.test(new URL(response.url()).pathname)
    ))
    await tech.getByRole('button', { name: 'Start work' }).click()
    const workResponse = await workResponsePromise
    expect(workResponse.status(), 'mounted work API status').toBe(200)
    await expect(tech.getByRole('heading', { name: 'Approved and ready' })).toBeVisible()
    await expect(tech).toHaveURL(new RegExp(`${path}$`))
    const clockResponsePromise = tech.waitForResponse((response) => (
      response.request().method() === 'POST'
      && /\/api\/tickets\/[0-9a-f-]+\/jobs\/[0-9a-f-]+\/work$/i.test(new URL(response.url()).pathname)
    ))
    await tech.getByRole('button', { name: 'Clock on' }).click()
    expect((await clockResponsePromise).status(), 'clock-on API status').toBe(200)
    await expect(tech.getByRole('heading', { name: 'Work in progress' })).toBeVisible()
    const note = tech.getByRole('textbox', { name: 'Work note' })
    await note.fill('Confirmed pad wear, replaced front pads, torqued hardware, and completed a quiet road test.')
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
    await expect(tech.getByText('Waiting on parts')).toBeVisible()
    await checkpoint(tech, testInfo, 'tech-work-and-part-request')

    const parts = sessions.get('parts')!.page
    await parts.goto('/today')
    await expect(parts.getByRole('heading', { name: 'Parts needed' })).toBeVisible()
    await checkpoint(parts, testInfo, 'parts-queue')
    await parts.getByRole('link', { name: 'Source parts' }).click()
    await expect(parts.getByRole('heading', { name: 'Parts the tech asked for' })).toBeVisible()
    await parts.getByRole('button', { name: 'Got it' }).click()
    await expect(parts.getByText('Got it')).toBeVisible()
    await expect(parts).toHaveURL(new RegExp(`${path}(?:#.*)?$`))

    await tech.reload()
    await expect(tech.getByRole('button', { name: 'Continue work' })).toBeVisible()
    await tech.getByRole('button', { name: 'Continue work' }).click()
    await expect(tech.getByText('Got it')).toBeVisible()
    await tech.getByRole('button', { name: 'Complete work' }).click()
    await expect(tech.getByRole('heading', { name: 'Work complete' })).toBeVisible()
    await tech.getByRole('button', { name: 'Close work' }).click()
    await expect(tech.getByText('Work · Done')).toBeVisible()
    await checkpoint(tech, testInfo, 'tech-complete-ticket')

    await advisor.reload()
    await advisor.getByRole('button', { name: 'Collect & close' }).click()
    await expect(advisor.getByRole('region', { name: 'Ring out' })).toBeFocused()
    await advisor.getByLabel('Payment amount').fill('194.40')
    await advisor.getByLabel('How paid').selectOption('card')
    await advisor.getByRole('button', { name: 'Record payment' }).click()
    await expect(advisor.getByText('$0.00').last()).toBeVisible()
    await advisor.getByRole('button', { name: 'Mark paid & close ticket' }).click()
    await expect(advisor.getByRole('heading', { name: 'Receipt' })).toBeVisible()
    await checkpoint(advisor, testInfo, 'advisor-closed-ticket')

    await owner.goto(path)
    await expect(owner.getByText('Closed · Counter intake', { exact: true })).toBeVisible()
    await expect(owner.getByRole('heading', { name: 'Receipt' })).toBeVisible()
    await owner.goto('/today')
    await expect(owner.getByRole('article', { name: new RegExp(`Ticket ${ticketNumber}:`) })).toHaveCount(0)
    await checkpoint(owner, testInfo, 'owner-closed-day')
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
