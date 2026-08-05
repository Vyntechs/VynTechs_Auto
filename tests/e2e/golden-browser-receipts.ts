import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, type TestInfo } from '@playwright/test'
import {
  isExpectedLocalAnalyticsConsole,
  isExpectedPageNavigationAbort,
  isExpectedProductRefusal,
} from './golden-browser-fault-filter'

type BrowserFaults = {
  consoleErrors: string[]
  pageErrors: string[]
  failedRequests: string[]
}

export function watchBrowserFaults(page: Page, label = 'browser'): BrowserFaults {
  const faults: BrowserFaults = { consoleErrors: [], pageErrors: [], failedRequests: [] }
  page.on('console', (message) => {
    const text = message.text()
    if (message.type() === 'error'
      && !isExpectedLocalAnalyticsConsole(page.url(), message.location().url, text)
      && !isExpectedProductRefusal(message.location().url, text)
    ) faults.consoleErrors.push(text)
  })
  page.on('pageerror', (error) => {
    faults.pageErrors.push(`[${label}] ${new URL(page.url()).pathname}: ${error.message}`)
  })
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'unknown failure'
    const pathname = new URL(request.url()).pathname
    if (!isExpectedPageNavigationAbort(request.method(), pathname, failure)) {
      faults.failedRequests.push(`${request.method()} ${pathname}: ${failure}`)
    }
  })
  return faults
}

export async function checkpoint(
  page: Page,
  testInfo: TestInfo,
  label: string,
): Promise<void> {
  await expect(page.locator('body')).toBeVisible()
  await expect.poll(async () => page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))).toEqual(expect.objectContaining({
    client: page.viewportSize()?.width,
    scroll: page.viewportSize()?.width,
  }))

  // Capture the page as the journey left it, before anything else runs in it.
  // axe-core injects into the document to analyze it, so a screenshot taken
  // afterwards is a picture of the page plus the tool, not the page.
  // Capture the viewport, not the full page. A full-page capture composites
  // `position: fixed` elements into the stitched image at a scroll-dependent
  // offset, which drew the app shell's off-screen skip link over the content
  // and read as a layout defect that does not exist. The viewport is also the
  // honest answer to "what does this look like at this width."
  const evidence = process.env.GOLDEN_QA_RETAIN_EVIDENCE === '1'
    ? testInfo.outputPath(`${label}.png`)
    : null
  if (evidence) await page.screenshot({ path: evidence })

  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const blocking = accessibility.violations.filter((violation) => (
    violation.impact === 'critical' || violation.impact === 'serious'
  ))

  await testInfo.attach(`${label}-accessibility`, {
    body: JSON.stringify({
      url: new URL(page.url()).pathname,
      seriousOrCritical: blocking.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.map((node) => node.target),
      })),
    }, null, 2),
    contentType: 'application/json',
  })

  // The overflow and accessibility gates above are machine truth. When a human
  // needs to review the same checkpoint by eye, retained evidence also keeps
  // the rendered page at the exact project viewport.
  if (evidence) {
    await testInfo.attach(`${label}.png`, { path: evidence, contentType: 'image/png' })
  }
  expect(blocking, `${label} has serious or critical accessibility violations`).toEqual([])
}

export function assertNoBrowserFaults(faults: BrowserFaults[]): void {
  expect(faults.flatMap((entry) => entry.pageErrors), 'uncaught browser errors').toEqual([])
  expect(faults.flatMap((entry) => entry.consoleErrors), 'browser console errors').toEqual([])
  expect(faults.flatMap((entry) => entry.failedRequests), 'failed browser requests').toEqual([])
}
