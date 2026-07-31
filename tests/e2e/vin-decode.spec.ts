import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { assertNoBrowserFaults, watchBrowserFaults } from './golden-browser-receipts'

/**
 * VIN decode against the live NHTSA service.
 *
 * This ran in production for weeks filling nothing: the route calls
 * `DecodeVinValues`, which answers with one flat row, but the parser read it as
 * the `{ Variable, Value }` pairs the sibling `DecodeVin` endpoint returns. The
 * unit fixtures mocked the pair shape, so a green suite proved the parser
 * against a payload the provider does not send. Only a real browser pressing
 * the real button found it, and only a real provider can keep finding it.
 *
 * It is deliberately its own suite. An NHTSA outage should report itself
 * plainly here and must never take the shop-day or post-diagnosis gates down
 * with it.
 */

// A genuine 2021 RAM 2500 VIN whose check digit passes, confirmed against
// vPIC directly: ErrorCode 0, ModelYear 2021, Make RAM, Model 2500,
// DisplacementL 6.7 with EngineModel empty — which is why the decoded engine
// reads as the displacement.
const VALID_VIN = '3C6UR5DL9MG500000'
// The same VIN with a wrong check digit. Every character is legal, so the route
// accepts it and NHTSA is the one that refuses — which is the branch that used
// to be reported to the writer as an outage.
const BAD_CHECK_DIGIT_VIN = '3C6UR5DL0MG500000'

function credential(): { email: string; password: string } {
  const email = process.env.GOLDEN_QA_OWNER_EMAIL
  const password = process.env.GOLDEN_QA_OWNER_PASSWORD
  if (!email || !password) throw new Error('Missing GOLDEN_QA_OWNER browser credential')
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
  const user = credential()
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

test('the counter decodes a real VIN and refuses a bad one honestly', async ({ browser, baseURL }, testInfo) => {
  if (!baseURL) throw new Error('Golden browser base URL is required')
  const viewport = testInfo.project.use.viewport ?? { width: 1440, height: 900 }
  const mobile = testInfo.project.use.isMobile ?? false

  let session: Awaited<ReturnType<typeof signedInPage>> | null = null
  try {
    session = await signedInPage(browser, baseURL, viewport, mobile)
    const owner = session.page
    const faults = [watchBrowserFaults(owner, 'owner')]

    await owner.getByRole('link', { name: 'New work order' }).click()
    const vin = owner.getByLabel('VIN')
    const decode = owner.getByRole('button', { name: 'Decode VIN' })

    // The button stays inert until a complete VIN is present, so a writer never
    // presses it into a refusal they caused by typing sixteen characters.
    await vin.fill(VALID_VIN.slice(0, 16))
    await expect(decode).toBeDisabled()

    await vin.fill(VALID_VIN)
    await expect(decode).toBeEnabled()
    const decodeResponse = owner.waitForResponse((response) => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/intake/decode-vin'
    ))
    await decode.click()
    expect((await decodeResponse).status(), 'live NHTSA decode API status').toBe(200)

    // Every assertion below is a field the writer no longer types. Before the
    // fix this VIN filled none of them and reported itself as unrecognized.
    await expect(owner.getByRole('status'))
      .toHaveText('VIN decoded. Verify each vehicle field before creating the ticket.')
    await expect(owner.getByLabel('Year')).toHaveValue('2021')
    await expect(owner.getByLabel('Make')).toHaveValue('RAM')
    await expect(owner.getByLabel('Model')).toHaveValue('2500')
    await expect(owner.getByLabel('Engine')).toHaveValue('6.7')

    // A VIN the provider rejects is the writer's VIN, not an outage, and has to
    // say so — reporting it as unavailable sent writers looking for a problem
    // that was not there.
    await vin.fill(BAD_CHECK_DIGIT_VIN)
    await decode.click()
    // Filtered because Next's own route announcer is also a live `alert`; the
    // filter is on the sentence being asserted, so it still proves the refusal
    // is announced assertively rather than printed silently.
    await expect(owner.getByRole('alert').filter({ hasText: 'VIN was not recognized' }))
      .toHaveText('VIN was not recognized. Enter the vehicle details manually.')

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
