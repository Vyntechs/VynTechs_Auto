import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop } from '@/lib/db/queries'
import { stripeCustomers } from '@/lib/db/schema'
import { handleStripeWebhook } from '@/lib/stripe'

function fakeSubscriptionEvent(
  type:
    | 'customer.subscription.created'
    | 'customer.subscription.updated'
    | 'customer.subscription.deleted',
  overrides: Partial<{
    customer: string
    status: string
    current_period_end: number
    itemPeriodEnd: number
  }> = {},
) {
  const top = overrides.current_period_end
  const itemEnd = overrides.itemPeriodEnd
  return {
    id: 'evt_subscription',
    type,
    data: {
      object: {
        id: 'sub_123',
        customer: overrides.customer ?? 'cus_garage',
        status: overrides.status ?? 'active',
        ...(top != null ? { current_period_end: top } : {}),
        items: {
          data: [
            {
              id: 'si_123',
              ...(itemEnd != null ? { current_period_end: itemEnd } : {}),
            },
          ],
        },
      },
    },
  } as never
}

describe('handleStripeWebhook — subscription lifecycle', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('persists status and period end on subscription.created', async () => {
    const shop = await createShop(db, { name: 'Joe Garage' })
    await db
      .insert(stripeCustomers)
      .values({ shopId: shop.id, stripeCustomerId: 'cus_garage' })

    const periodEnd = 1_780_000_000 // arbitrary unix seconds
    const result = await handleStripeWebhook({
      db,
      body: '{}',
      signature: 't=1,v1=valid',
      secret: 'whsec_test',
      constructEvent: () =>
        fakeSubscriptionEvent('customer.subscription.created', {
          status: 'active',
          current_period_end: periodEnd,
        }),
    })

    expect(result.ok).toBe(true)
    const [row] = await db
      .select()
      .from(stripeCustomers)
      .where(eq(stripeCustomers.shopId, shop.id))
    expect(row.subscriptionStatus).toBe('active')
    expect(row.currentPeriodEnd?.toISOString()).toBe(
      new Date(periodEnd * 1000).toISOString(),
    )
  })

  it('updates status on subscription.updated', async () => {
    const shop = await createShop(db, { name: 'Joe Garage' })
    await db.insert(stripeCustomers).values({
      shopId: shop.id,
      stripeCustomerId: 'cus_garage',
      subscriptionStatus: 'active',
    })

    await handleStripeWebhook({
      db,
      body: '{}',
      signature: 't=1,v1=valid',
      secret: 'whsec_test',
      constructEvent: () =>
        fakeSubscriptionEvent('customer.subscription.updated', {
          status: 'past_due',
          current_period_end: 1_780_500_000,
        }),
    })

    const [row] = await db
      .select()
      .from(stripeCustomers)
      .where(eq(stripeCustomers.shopId, shop.id))
    expect(row.subscriptionStatus).toBe('past_due')
  })

  it('marks status canceled on subscription.deleted', async () => {
    const shop = await createShop(db, { name: 'Joe Garage' })
    await db.insert(stripeCustomers).values({
      shopId: shop.id,
      stripeCustomerId: 'cus_garage',
      subscriptionStatus: 'active',
    })

    await handleStripeWebhook({
      db,
      body: '{}',
      signature: 't=1,v1=valid',
      secret: 'whsec_test',
      constructEvent: () =>
        fakeSubscriptionEvent('customer.subscription.deleted', {
          status: 'canceled',
        }),
    })

    const [row] = await db
      .select()
      .from(stripeCustomers)
      .where(eq(stripeCustomers.shopId, shop.id))
    expect(row.subscriptionStatus).toBe('canceled')
  })

  it('falls back to items[0].current_period_end when newer Stripe API omits the top-level field', async () => {
    const shop = await createShop(db, { name: 'Joe Garage' })
    await db
      .insert(stripeCustomers)
      .values({ shopId: shop.id, stripeCustomerId: 'cus_garage' })

    const itemEnd = 1_790_000_000
    await handleStripeWebhook({
      db,
      body: '{}',
      signature: 't=1,v1=valid',
      secret: 'whsec_test',
      constructEvent: () =>
        fakeSubscriptionEvent('customer.subscription.created', {
          status: 'active',
          itemPeriodEnd: itemEnd,
        }),
    })

    const [row] = await db
      .select()
      .from(stripeCustomers)
      .where(eq(stripeCustomers.shopId, shop.id))
    expect(row.currentPeriodEnd?.toISOString()).toBe(
      new Date(itemEnd * 1000).toISOString(),
    )
  })

  it('passes through non-subscription events without DB writes', async () => {
    const shop = await createShop(db, { name: 'Joe Garage' })
    await db
      .insert(stripeCustomers)
      .values({ shopId: shop.id, stripeCustomerId: 'cus_garage' })

    const result = await handleStripeWebhook({
      db,
      body: '{}',
      signature: 't=1,v1=valid',
      secret: 'whsec_test',
      constructEvent: () =>
        ({
          id: 'evt_x',
          type: 'invoice.payment_succeeded',
          data: { object: { id: 'in_123' } },
        }) as never,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.eventType).toBe('invoice.payment_succeeded')
    const [row] = await db
      .select()
      .from(stripeCustomers)
      .where(eq(stripeCustomers.shopId, shop.id))
    // unchanged
    expect(row.subscriptionStatus).toBeNull()
  })

  it('does not error when event customer is not yet in the database', async () => {
    const result = await handleStripeWebhook({
      db,
      body: '{}',
      signature: 't=1,v1=valid',
      secret: 'whsec_test',
      constructEvent: () =>
        fakeSubscriptionEvent('customer.subscription.created', {
          customer: 'cus_unknown',
          status: 'active',
        }),
    })

    expect(result.ok).toBe(true)
  })
})
