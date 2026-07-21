import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, type TestInfo } from '@playwright/test'
import { isExpectedPageNavigationAbort } from './golden-browser-fault-filter'

type BrowserFaults = {
  consoleErrors: string[]
  pageErrors: string[]
  failedRequests: string[]
}

export function watchBrowserFaults(page: Page): BrowserFaults {
  const faults: BrowserFaults = { consoleErrors: [], pageErrors: [], failedRequests: [] }
  page.on('console', (message) => {
    if (message.type() === 'error') faults.consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => faults.pageErrors.push(error.message))
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
  expect(blocking, `${label} has serious or critical accessibility violations`).toEqual([])
}

export function assertNoBrowserFaults(faults: BrowserFaults[]): void {
  expect(faults.flatMap((entry) => entry.pageErrors), 'uncaught browser errors').toEqual([])
  expect(faults.flatMap((entry) => entry.consoleErrors), 'browser console errors').toEqual([])
  expect(faults.flatMap((entry) => entry.failedRequests), 'failed browser requests').toEqual([])
}
