import { test, expect } from '@playwright/test'

const OWNER_EMAIL = process.env.OWNER_TEST_EMAIL
const OWNER_PASSWORD = process.env.OWNER_TEST_PASSWORD

test.describe('Counter intake — advisor write-up persistence', () => {
  test.skip(
    !OWNER_EMAIL || !OWNER_PASSWORD,
    'OWNER_TEST_EMAIL / OWNER_TEST_PASSWORD env vars not set',
  )

  test('owner can write up a customer + vehicle and lands on /sessions/:id', async ({ page }) => {
    await page.goto('/sign-in')
    await page.getByLabel(/email/i).fill(OWNER_EMAIL!)
    await page.getByLabel(/password/i).fill(OWNER_PASSWORD!)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL(/\/today/)

    await page.goto('/intake')
    await expect(page).toHaveURL(/\/intake$/)

    const uniquePhone = `555-${Date.now().toString().slice(-7)}`
    const uniqueVin = `TEST${Date.now()}`.padEnd(17, '0').slice(0, 17)

    await page.getByLabel(/^name$/i).fill('Test Customer')
    await page.getByLabel(/phone/i).fill(uniquePhone)
    await page.getByLabel(/vin/i).fill(uniqueVin)
    await page.getByLabel(/year/i).fill('2018')
    await page.getByLabel(/make/i).fill('Ford')
    await page.getByLabel(/model/i).fill('F-150')
    await page.getByLabel(/what brought them in/i).fill('Test complaint from e2e suite')

    await page.getByRole('button', { name: /send to techs/i }).first().click()
    await page.waitForURL(/\/sessions\/[0-9a-f-]+$/)

    expect(page.url()).toMatch(/\/sessions\/[0-9a-f-]+$/)
  })
})
