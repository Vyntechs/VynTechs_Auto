import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  assertNoBrowserFaults,
  checkpoint,
  watchBrowserFaults,
} from './golden-browser-receipts'

const evidenceDirectory = resolve(process.cwd(), 'test-results/customer-copy')

test('the real CustomerCopy component locks native print around one fresh authorized attempt', async ({ page }, testInfo) => {
  const faults = watchBrowserFaults(page, testInfo.project.name)
  await page.goto('/?state=ready')

  const action = page.getByRole('button', { name: 'Customer copy' })
  await expect(action).toBeVisible()
  await expect(page.getByRole('region', { name: 'Customer copy preview' })).toBeHidden()
  await action.click()

  const preview = page.getByRole('region', { name: 'Customer copy preview' })
  const document = page.locator('[data-customer-copy-document]')
  await expect(preview).toBeVisible()
  await expect(preview.getByRole('heading', { name: 'Invoice' })).toBeFocused()
  await expect(document).toContainText('Honest Auto')
  await expect(document).toContainText('Ada Driver')
  await expect(document).toContainText('2020 Ford F-150')
  await expect(document).toContainText('1FTFW1E50LFA00001')
  await expect(document).toContainText('Brake pad set')
  await expect(document).toContainText('$295.50')
  await expect(document).not.toContainText('STAFF-ONLY-SENTINEL')
  await expect(document).not.toContainText('PRIVATE-PAYMENT-NOTE-SENTINEL')
  await expect(document).toHaveAttribute('data-print-ready', 'false')

  await page.emulateMedia({ media: 'print' })
  await expect(document).toHaveCSS('display', 'none')
  await expect(page.locator('[data-customer-copy-print-blocker]')).toHaveCSS('display', 'block')
  await expect(page.locator('[data-fixture-app-chrome]')).toHaveCSS('display', 'none')
  await expect(page.locator('[data-staff-only]')).toHaveCSS('display', 'none')
  await expect(page.locator('[data-long-surrounding]')).toHaveCSS('display', 'none')
  await checkpoint(page, testInfo, `${testInfo.project.name}-native-prebutton-blocked`)

  await page.emulateMedia({ media: 'screen' })

  await page.getByRole('button', { name: 'Print customer copy' }).click()
  await expect(page.locator('body')).toHaveAttribute('data-refresh-count', '1')
  await expect(page.locator('body')).toHaveAttribute('data-print-calls', '1')
  await expect(page.locator('body')).toHaveAttribute('data-print-ready-at-call', 'true')
  await expect(document).toHaveAttribute('data-print-ready', 'true')

  await mkdir(evidenceDirectory, { recursive: true })
  const screenEvidence = resolve(evidenceDirectory, `${testInfo.project.name}-screen.png`)
  await page.screenshot({ path: screenEvidence })
  await checkpoint(page, testInfo, `${testInfo.project.name}-screen`)

  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('[data-fixture-app-chrome]')).toHaveCSS('display', 'none')
  await expect(page.locator('[data-staff-only]')).toHaveCSS('display', 'none')
  await expect(page.locator('[data-long-surrounding]')).toHaveCSS('display', 'none')
  await expect(page.locator('[data-customer-copy-controls]')).toHaveCSS('display', 'none')
  await expect(document).toHaveCSS('display', 'block')
  await expect.poll(() => document.evaluate((node) => ({
    left: node.getBoundingClientRect().left,
    right: node.getBoundingClientRect().right,
    viewport: node.ownerDocument.documentElement.clientWidth,
  }))).toEqual({ left: 0, right: testInfo.project.use.viewport?.width, viewport: testInfo.project.use.viewport?.width })

  const printEvidence = resolve(evidenceDirectory, `${testInfo.project.name}-print.png`)
  await page.screenshot({ path: printEvidence, fullPage: true })
  await checkpoint(page, testInfo, `${testInfo.project.name}-print`)

  await page.emulateMedia({ media: 'screen' })
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await expect(document).toHaveAttribute('data-print-ready', 'false')

  await page.emulateMedia({ media: 'print' })
  await expect(document).toHaveCSS('display', 'none')
  await expect(page.locator('[data-customer-copy-print-blocker]')).toHaveCSS('display', 'block')
  await checkpoint(page, testInfo, `${testInfo.project.name}-afterprint-relocked`)
  assertNoBrowserFaults([faults])
})

test('native print fails closed for blocked real CustomerCopy paperwork', async ({ page }, testInfo) => {
  const faults = watchBrowserFaults(page, `${testInfo.project.name}-blocked`)
  await page.goto('/?state=blocked')
  await page.getByRole('button', { name: 'Customer copy' }).click()

  const document = page.locator('[data-customer-copy-document]')
  await expect(document).toHaveAttribute('data-print-ready', 'false')
  await expect(page.getByRole('button', { name: 'Print customer copy' })).toBeDisabled()

  await page.emulateMedia({ media: 'print' })
  await expect(document).toHaveCSS('display', 'none')
  await expect(page.locator('[data-customer-copy-print-blocker]')).toHaveCSS('display', 'block')
  await expect(page.locator('[data-fixture-app-chrome]')).toHaveCSS('display', 'none')
  await expect(page.locator('[data-staff-only]')).toHaveCSS('display', 'none')
  await expect(page.locator('[data-long-surrounding]')).toHaveCSS('display', 'none')
  await checkpoint(page, testInfo, `${testInfo.project.name}-blocked-print`)
  assertNoBrowserFaults([faults])
})
