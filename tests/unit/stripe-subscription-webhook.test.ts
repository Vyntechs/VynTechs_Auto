import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { PGlite } from '@electric-sql/pglite'
import type Stripe from 'stripe'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop } from '@/lib/db/queries'
import { processedStripeEvents, shopEntitlements, stripeCustomers } from '@/lib/db/schema'
import { handleStripeWebhook } from '@/lib/stripe'

function fakeSubscriptionEvent(
  type:
    | 'customer.subscription.created'
    | 'customer.subscription.updated'
    | 'customer.subscription.deleted',
  overrides: Partial<{
    eventId: string
    eventCreated: number
    customer: string
    status: string
    current_period_end: number
    itemPeriodEnd: number
    priceIds: string[]
  }> = {},
) {
  const top = overrides.current_period_end
  const itemEnd = overrides.itemPeriodEnd
  return {
    id: overrides.eventId ?? 'evt_subscription',
    created: overrides.eventCreated ?? 100,
    type,
    data: {
      object: {
        id: 'sub_123',
        customer: overrides.customer ?? 'cus_garage',
        status: overrides.status ?? 'active',
        ...(top != null ? { current_period_end: top } : {}),
        items: {
          data: overrides.priceIds
            ? overrides.priceIds.map((priceId, index) => ({
                id: `si_${index}`,
                price: { id: priceId },
                ...(index === 0 && itemEnd != null ? { current_period_end: itemEnd } : {}),
              }))
            : [{
                id: 'si_123',
                ...(itemEnd != null ? { current_period_end: itemEnd } : {}),
              }],
        },
      },
    },
  } as unknown as Stripe.Event
}

describe('handleStripeWebhook — subscription lifecycle', () => {
  let db: TestDb
  let client: PGlite
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, client, close } = await createTestDb())
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
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

  it('deduplicates one event even after a newer transition has applied', async () => {
    const shop = await createShop(db, { name: 'Joe Garage' })
    await db.insert(stripeCustomers).values({
      shopId: shop.id,
      stripeCustomerId: 'cus_garage',
    })
    const active = fakeSubscriptionEvent('customer.subscription.created', {
      eventId: 'evt_active',
      eventCreated: 100,
      status: 'active',
    })
    const canceled = fakeSubscriptionEvent('customer.subscription.deleted', {
      eventId: 'evt_canceled',
      eventCreated: 200,
      status: 'canceled',
    })

    for (const event of [active, active, canceled, active]) {
      const result = await handleStripeWebhook({
        db,
        body: '{}',
        signature: 't=1,v1=valid',
        secret: 'whsec_test',
        constructEvent: () => event,
      })
      expect(result.ok).toBe(true)
    }

    const [row] = await db.select().from(stripeCustomers)
      .where(eq(stripeCustomers.shopId, shop.id))
    expect(row.subscriptionStatus).toBe('canceled')
    expect(row.lastWebhookEventId).toBe('evt_canceled')
    expect(await db.select().from(processedStripeEvents)).toHaveLength(2)
  })

  it('records a distinct older event as stale without regressing billing truth', async () => {
    const shop = await createShop(db, { name: 'Joe Garage' })
    await db.insert(stripeCustomers).values({ shopId: shop.id, stripeCustomerId: 'cus_garage' })
    const fire = (event: ReturnType<typeof fakeSubscriptionEvent>) => handleStripeWebhook({
      db,
      body: '{}',
      signature: 't=1,v1=valid',
      secret: 'whsec_test',
      constructEvent: () => event,
    })

    await fire(fakeSubscriptionEvent('customer.subscription.deleted', {
      eventId: 'evt_newer', eventCreated: 200, status: 'canceled',
    }))
    await fire(fakeSubscriptionEvent('customer.subscription.updated', {
      eventId: 'evt_older', eventCreated: 100, status: 'active',
    }))

    const [row] = await db.select().from(stripeCustomers)
      .where(eq(stripeCustomers.shopId, shop.id))
    const events = await db.select().from(processedStripeEvents)
    expect(row.subscriptionStatus).toBe('canceled')
    expect(row.lastWebhookEventId).toBe('evt_newer')
    expect(events.find(({ eventId }) => eventId === 'evt_older')?.disposition).toBe('stale')
  })

  it('advances normally when an older event arrives before a newer event', async () => {
    const shop = await createShop(db, { name: 'Joe Garage' })
    await db.insert(stripeCustomers).values({ shopId: shop.id, stripeCustomerId: 'cus_garage' })
    for (const event of [
      fakeSubscriptionEvent('customer.subscription.created', {
        eventId: 'evt_older', eventCreated: 100, status: 'trialing',
      }),
      fakeSubscriptionEvent('customer.subscription.updated', {
        eventId: 'evt_newer', eventCreated: 200, status: 'active',
      }),
    ]) {
      await handleStripeWebhook({
        db,
        body: '{}',
        signature: 't=1,v1=valid',
        secret: 'whsec_test',
        constructEvent: () => event,
      })
    }

    const [row] = await db.select().from(stripeCustomers)
      .where(eq(stripeCustomers.shopId, shop.id))
    expect(row.subscriptionStatus).toBe('active')
    expect(row.lastWebhookEventId).toBe('evt_newer')
    expect(row.lastWebhookEventCreated).toBe(200)
  })

  it('serializes concurrent distinct events to the newest provider timestamp', async () => {
    const shop = await createShop(db, { name: 'Joe Garage' })
    await db.insert(stripeCustomers).values({ shopId: shop.id, stripeCustomerId: 'cus_garage' })
    const events = [
      fakeSubscriptionEvent('customer.subscription.created', {
        eventId: 'evt_concurrent_older', eventCreated: 100, status: 'active',
      }),
      fakeSubscriptionEvent('customer.subscription.deleted', {
        eventId: 'evt_concurrent_newer', eventCreated: 200, status: 'canceled',
      }),
    ]

    const results = await Promise.all(events.map((event) => handleStripeWebhook({
      db,
      body: '{}',
      signature: 't=1,v1=valid',
      secret: 'whsec_test',
      constructEvent: () => event,
    })))

    expect(results.every((result) => result.ok)).toBe(true)
    const [row] = await db.select().from(stripeCustomers)
      .where(eq(stripeCustomers.shopId, shop.id))
    expect(row.subscriptionStatus).toBe('canceled')
    expect(row.lastWebhookEventId).toBe('evt_concurrent_newer')
    expect(await db.select().from(processedStripeEvents)).toHaveLength(2)
  })

  it('reconciles distinct equal-second events from authoritative Stripe state', async () => {
    const shop = await createShop(db, { name: 'Joe Garage' })
    await db.insert(stripeCustomers).values({ shopId: shop.id, stripeCustomerId: 'cus_garage' })
    await handleStripeWebhook({
      db,
      body: '{}',
      signature: 't=1,v1=valid',
      secret: 'whsec_test',
      constructEvent: () => fakeSubscriptionEvent('customer.subscription.updated', {
        eventId: 'evt_equal_a', eventCreated: 100, status: 'active',
      }),
    })
    const retrieveSubscription = vi.fn().mockResolvedValue(
      fakeSubscriptionEvent('customer.subscription.deleted', {
        status: 'canceled',
      }).data.object as Stripe.Subscription,
    )

    const result = await handleStripeWebhook({
      db,
      body: '{}',
      signature: 't=1,v1=valid',
      secret: 'whsec_test',
      constructEvent: () => fakeSubscriptionEvent('customer.subscription.updated', {
        eventId: 'evt_equal_b', eventCreated: 100, status: 'active',
      }),
      retrieveSubscription,
    })

    expect(result.ok).toBe(true)
    expect(retrieveSubscription).toHaveBeenCalledWith('sub_123')
    const [row] = await db.select().from(stripeCustomers)
      .where(eq(stripeCustomers.shopId, shop.id))
    const [event] = await db.select().from(processedStripeEvents)
      .where(eq(processedStripeEvents.eventId, 'evt_equal_b'))
    expect(row.subscriptionStatus).toBe('canceled')
    expect(event.disposition).toBe('reconciled')
  })

  it('uses authoritative active add-on truth when an equal-second deleted envelope is ambiguous', async () => {
    vi.stubEnv('STRIPE_DIAGNOSTICS_PRICE_ID', 'price_diag_test')
    const shop = await createShop(db, { name: 'Joe Garage' })
    await db.insert(stripeCustomers).values({ shopId: shop.id, stripeCustomerId: 'cus_garage' })
    await handleStripeWebhook({
      db,
      body: '{}',
      signature: 't=1,v1=valid',
      secret: 'whsec_test',
      constructEvent: () => fakeSubscriptionEvent('customer.subscription.updated', {
        eventId: 'evt_equal_active_a', eventCreated: 100, status: 'active',
        priceIds: ['price_diag_test'],
      }),
    })
    const authoritative = fakeSubscriptionEvent('customer.subscription.updated', {
      status: 'active',
      priceIds: ['price_diag_test'],
    }).data.object as Stripe.Subscription

    const result = await handleStripeWebhook({
      db,
      body: '{}',
      signature: 't=1,v1=valid',
      secret: 'whsec_test',
      constructEvent: () => fakeSubscriptionEvent('customer.subscription.deleted', {
        eventId: 'evt_equal_deleted_b', eventCreated: 100, status: 'canceled',
      }),
      retrieveSubscription: vi.fn().mockResolvedValue(authoritative),
    })

    expect(result.ok).toBe(true)
    const [customer] = await db.select().from(stripeCustomers)
      .where(eq(stripeCustomers.shopId, shop.id))
    const [entitlement] = await db.select().from(shopEntitlements)
      .where(eq(shopEntitlements.shopId, shop.id))
    expect(customer.subscriptionStatus).toBe('active')
    expect(entitlement.diagnostics).toBe(true)
  })

  it('rolls back an equal-second claim when authoritative retrieval fails', async () => {
    const shop = await createShop(db, { name: 'Joe Garage' })
    await db.insert(stripeCustomers).values({ shopId: shop.id, stripeCustomerId: 'cus_garage' })
    await handleStripeWebhook({
      db,
      body: '{}',
      signature: 't=1,v1=valid',
      secret: 'whsec_test',
      constructEvent: () => fakeSubscriptionEvent('customer.subscription.updated', {
        eventId: 'evt_equal_a', eventCreated: 100, status: 'active',
      }),
    })

    const result = await handleStripeWebhook({
      db,
      body: '{}',
      signature: 't=1,v1=valid',
      secret: 'whsec_test',
      constructEvent: () => fakeSubscriptionEvent('customer.subscription.deleted', {
        eventId: 'evt_equal_b', eventCreated: 100, status: 'canceled',
      }),
      retrieveSubscription: vi.fn().mockRejectedValue(new Error('Stripe unavailable')),
    })

    expect(result).toEqual({ ok: false, status: 500, error: 'webhook processing failed' })
    const [row] = await db.select().from(stripeCustomers)
      .where(eq(stripeCustomers.shopId, shop.id))
    expect(row.subscriptionStatus).toBe('active')
    expect(row.lastWebhookEventId).toBe('evt_equal_a')
    expect(await db.select().from(processedStripeEvents)).toHaveLength(1)
  })

  it('rolls back base state and event claim when entitlement projection fails', async () => {
    vi.stubEnv('STRIPE_DIAGNOSTICS_PRICE_ID', 'price_diag_test')
    const shop = await createShop(db, { name: 'Joe Garage' })
    await db.insert(stripeCustomers).values({ shopId: shop.id, stripeCustomerId: 'cus_garage' })
    await client.exec(`
      create function synthetic_entitlement_failure() returns trigger
      language plpgsql as $$ begin raise exception 'synthetic entitlement failure'; end $$;
      create trigger synthetic_entitlement_failure_trigger
      before insert or update on shop_entitlements
      for each row execute function synthetic_entitlement_failure();
    `)
    const event = fakeSubscriptionEvent('customer.subscription.created', {
      eventId: 'evt_atomic',
      eventCreated: 100,
      status: 'active',
      priceIds: ['price_diag_test'],
    })

    const result = await handleStripeWebhook({
      db,
      body: '{}',
      signature: 't=1,v1=valid',
      secret: 'whsec_test',
      constructEvent: () => event,
    })

    expect(result).toEqual({ ok: false, status: 500, error: 'webhook processing failed' })
    const [row] = await db.select().from(stripeCustomers)
      .where(eq(stripeCustomers.shopId, shop.id))
    expect(row.subscriptionStatus).toBeNull()
    expect(row.lastWebhookEventId).toBeNull()
    expect(await db.select().from(processedStripeEvents)).toHaveLength(0)
    expect(await db.select().from(shopEntitlements)).toHaveLength(0)
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
