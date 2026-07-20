import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop } from '@/lib/db/queries'
import { processedStripeEvents, shopEntitlements, stripeCustomers } from '@/lib/db/schema'
import { handleStripeWebhook } from '@/lib/stripe'

const DIAG_PRICE = 'price_diag_test'
const BASE_PRICE = 'price_base_test'

function subscriptionEvent(
  type:
    | 'customer.subscription.created'
    | 'customer.subscription.updated'
    | 'customer.subscription.deleted',
  overrides: Partial<{
    id: string
    created: number
    customer: string
    status: string
    priceIds: string[]
  }> = {},
) {
  return {
    id: overrides.id ?? 'evt_subscription',
    created: overrides.created ?? 100,
    type,
    data: {
      object: {
        id: 'sub_123',
        customer: overrides.customer ?? 'cus_garage',
        status: overrides.status ?? 'active',
        items: {
          data: (overrides.priceIds ?? [BASE_PRICE]).map((priceId, index) => ({
            id: `si_${index}`,
            price: { id: priceId },
          })),
        },
      },
    },
  } as never
}

async function fireWebhook(db: TestDb, event: unknown) {
  return handleStripeWebhook({
    db,
    body: '{}',
    signature: 't=1,v1=valid',
    secret: 'whsec_test',
    constructEvent: () => event as never,
  })
}

describe('handleStripeWebhook — diagnostics entitlement mapping', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const shop = await createShop(db, { name: 'Joe Garage' })
    shopId = shop.id
    await db
      .insert(stripeCustomers)
      .values({ shopId: shop.id, stripeCustomerId: 'cus_garage' })
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await close()
  })

  it("is inert when STRIPE_DIAGNOSTICS_PRICE_ID is unset (today's reality)", async () => {
    vi.stubEnv('STRIPE_DIAGNOSTICS_PRICE_ID', '')
    const result = await fireWebhook(
      db,
      subscriptionEvent('customer.subscription.created', {
        priceIds: [BASE_PRICE, DIAG_PRICE],
      }),
    )
    expect(result.ok).toBe(true)
    const rows = await db.select().from(shopEntitlements)
    expect(rows).toHaveLength(0)
    // subscription status mapping still applies unchanged
    const [customer] = await db
      .select()
      .from(stripeCustomers)
      .where(eq(stripeCustomers.shopId, shopId))
    expect(customer.subscriptionStatus).toBe('active')
  })

  it('maps the add-on item presence to diagnostics=true when the env is set', async () => {
    vi.stubEnv('STRIPE_DIAGNOSTICS_PRICE_ID', DIAG_PRICE)
    await fireWebhook(
      db,
      subscriptionEvent('customer.subscription.updated', {
        priceIds: [BASE_PRICE, DIAG_PRICE],
      }),
    )
    const [row] = await db
      .select()
      .from(shopEntitlements)
      .where(eq(shopEntitlements.shopId, shopId))
    expect(row.diagnostics).toBe(true)
    expect(row.stripePriceId).toBe(DIAG_PRICE)
  })

  it('maps the add-on item absence to diagnostics=false, updating an existing row', async () => {
    vi.stubEnv('STRIPE_DIAGNOSTICS_PRICE_ID', DIAG_PRICE)
    await db.insert(shopEntitlements).values({
      shopId,
      diagnostics: true,
      stripePriceId: DIAG_PRICE,
    })
    await fireWebhook(
      db,
      subscriptionEvent('customer.subscription.updated', {
        priceIds: [BASE_PRICE],
      }),
    )
    const [row] = await db
      .select()
      .from(shopEntitlements)
      .where(eq(shopEntitlements.shopId, shopId))
    expect(row.diagnostics).toBe(false)
    expect(row.stripePriceId).toBeNull()
  })

  it('treats subscription.deleted as absence even when the item is still listed', async () => {
    vi.stubEnv('STRIPE_DIAGNOSTICS_PRICE_ID', DIAG_PRICE)
    await fireWebhook(
      db,
      subscriptionEvent('customer.subscription.deleted', {
        status: 'canceled',
        priceIds: [BASE_PRICE, DIAG_PRICE],
      }),
    )
    const [row] = await db
      .select()
      .from(shopEntitlements)
      .where(eq(shopEntitlements.shopId, shopId))
    expect(row.diagnostics).toBe(false)
  })

  it('keeps newer cancellation and add-on removal when an older active event arrives later', async () => {
    vi.stubEnv('STRIPE_DIAGNOSTICS_PRICE_ID', DIAG_PRICE)

    await fireWebhook(
      db,
      subscriptionEvent('customer.subscription.deleted', {
        id: 'evt_newer_deleted',
        created: 200,
        status: 'canceled',
        priceIds: [BASE_PRICE],
      }),
    )
    await fireWebhook(
      db,
      subscriptionEvent('customer.subscription.updated', {
        id: 'evt_older_active',
        created: 100,
        status: 'active',
        priceIds: [BASE_PRICE, DIAG_PRICE],
      }),
    )

    const [customer] = await db
      .select()
      .from(stripeCustomers)
      .where(eq(stripeCustomers.shopId, shopId))
    const [entitlement] = await db
      .select()
      .from(shopEntitlements)
      .where(eq(shopEntitlements.shopId, shopId))
    expect(customer.subscriptionStatus).toBe('canceled')
    expect(entitlement.diagnostics).toBe(false)
  })

  it('does not error and writes nothing for an unknown customer', async () => {
    vi.stubEnv('STRIPE_DIAGNOSTICS_PRICE_ID', DIAG_PRICE)
    const result = await fireWebhook(
      db,
      subscriptionEvent('customer.subscription.created', {
        customer: 'cus_unknown',
        priceIds: [DIAG_PRICE],
      }),
    )
    expect(result.ok).toBe(true)
    expect(await db.select().from(shopEntitlements)).toHaveLength(0)
    expect(await db.select().from(processedStripeEvents)).toHaveLength(0)
  })
})
