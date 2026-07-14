import Stripe from 'stripe'
import { eq } from 'drizzle-orm'
import { shopEntitlements, stripeCustomers } from './db/schema'
import { getProfileByUserId } from './db/queries'
import type { AppDb } from './db/queries'

let _client: Stripe | undefined

function getClient(): Stripe {
  if (!_client) {
    _client = new Stripe(process.env.STRIPE_SECRET_KEY ?? '')
  }
  return _client
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    const client = getClient()
    const value = Reflect.get(client, prop, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

export type CreateStripeCustomerFn = (params: {
  email: string
  metadata: { shopId: string }
}) => Promise<{ id: string }>

export async function ensureStripeCustomer(opts: {
  db: AppDb
  shopId: string
  email: string
  createCustomer?: CreateStripeCustomerFn
}): Promise<string> {
  const existing = await opts.db
    .select()
    .from(stripeCustomers)
    .where(eq(stripeCustomers.shopId, opts.shopId))
    .limit(1)
  if (existing[0]) return existing[0].stripeCustomerId

  const create =
    opts.createCustomer ??
    ((params) => stripe.customers.create(params))
  const customer = await create({
    email: opts.email,
    metadata: { shopId: opts.shopId },
  })
  await opts.db.insert(stripeCustomers).values({
    shopId: opts.shopId,
    stripeCustomerId: customer.id,
  })
  return customer.id
}

export type CreateBillingPortalSessionFn = (params: {
  customer: string
  return_url: string
}) => Promise<{ url: string }>

export type CreateBillingPortalSessionResult =
  | { ok: true; url: string }
  | { ok: false; status: 400; error: string }

export async function createBillingPortalSessionForUser(opts: {
  db: AppDb
  userId: string
  origin: string
  createPortalSession?: CreateBillingPortalSessionFn
}): Promise<CreateBillingPortalSessionResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }
  if (!profile.shopId) return { ok: false, status: 400, error: 'no shop' }

  const [customer] = await opts.db
    .select()
    .from(stripeCustomers)
    .where(eq(stripeCustomers.shopId, profile.shopId))
    .limit(1)
  if (!customer) {
    return { ok: false, status: 400, error: 'no stripe customer' }
  }

  const create =
    opts.createPortalSession ??
    ((params) => stripe.billingPortal.sessions.create(params))
  const session = await create({
    customer: customer.stripeCustomerId,
    return_url: `${opts.origin}/settings/billing`,
  })
  return { ok: true, url: session.url }
}

export type CreateCheckoutSessionFn = (params: {
  customer: string
  mode: 'subscription'
  line_items: Array<{ price: string; quantity: number }>
  success_url: string
  cancel_url: string
}) => Promise<{ id: string; url: string | null }>

export type CreateCheckoutSessionResult =
  | { ok: true; url: string }
  | { ok: false; status: 400 | 500; error: string }

export async function createCheckoutSessionForUser(opts: {
  db: AppDb
  userId: string
  email: string
  origin: string
  priceId: string
  createCheckout?: CreateCheckoutSessionFn
  createCustomer?: CreateStripeCustomerFn
}): Promise<CreateCheckoutSessionResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }
  if (!profile.shopId) return { ok: false, status: 400, error: 'no shop' }
  if (!opts.priceId) {
    return { ok: false, status: 500, error: 'price not configured' }
  }

  const customerId = await ensureStripeCustomer({
    db: opts.db,
    shopId: profile.shopId,
    email: opts.email,
    createCustomer: opts.createCustomer,
  })

  const create =
    opts.createCheckout ??
    ((params) => stripe.checkout.sessions.create(params))
  const session = await create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: opts.priceId, quantity: 1 }],
    success_url: `${opts.origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${opts.origin}/sign-up?canceled=true`,
  })
  if (!session.url) {
    return { ok: false, status: 500, error: 'no checkout url returned' }
  }
  return { ok: true, url: session.url }
}

export type ConstructStripeEventFn = (
  body: string,
  signature: string,
  secret: string,
) => Stripe.Event

export type HandleStripeWebhookResult =
  | { ok: true; eventType: Stripe.Event.Type }
  | { ok: false; status: 400 | 500; error: string }

const SUBSCRIPTION_EVENT_TYPES = new Set<Stripe.Event.Type>([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
])

function readSubscriptionPeriodEnd(
  subscription: Stripe.Subscription,
): Date | null {
  const top = (subscription as unknown as { current_period_end?: number })
    .current_period_end
  if (typeof top === 'number') return new Date(top * 1000)
  const itemEnd = (
    subscription.items?.data?.[0] as
      | { current_period_end?: number }
      | undefined
  )?.current_period_end
  if (typeof itemEnd === 'number') return new Date(itemEnd * 1000)
  return null
}

async function applySubscriptionEvent(
  db: AppDb,
  subscription: Stripe.Subscription,
  eventType: Stripe.Event.Type,
): Promise<void> {
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id
  await db
    .update(stripeCustomers)
    .set({
      subscriptionStatus: subscription.status,
      currentPeriodEnd: readSubscriptionPeriodEnd(subscription),
    })
    .where(eq(stripeCustomers.stripeCustomerId, customerId))
  await applyDiagnosticsEntitlement(db, subscription, customerId, eventType)
}

// Maps the diagnostics add-on subscription item to shop_entitlements
// (plan §3.3). Deliberately inert while STRIPE_DIAGNOSTICS_PRICE_ID is
// unset — no price exists yet, so no entitlement row is ever written from
// here today. Once the env var is set: item present on a live subscription
// → diagnostics true; item absent (or the subscription deleted) →
// diagnostics false. No pricing amounts live in code.
async function applyDiagnosticsEntitlement(
  db: AppDb,
  subscription: Stripe.Subscription,
  customerId: string,
  eventType: Stripe.Event.Type,
): Promise<void> {
  const priceId = process.env.STRIPE_DIAGNOSTICS_PRICE_ID
  if (!priceId) return

  const [customer] = await db
    .select({ shopId: stripeCustomers.shopId })
    .from(stripeCustomers)
    .where(eq(stripeCustomers.stripeCustomerId, customerId))
    .limit(1)
  if (!customer?.shopId) return

  const items = subscription.items?.data ?? []
  const diagnostics =
    eventType !== 'customer.subscription.deleted' &&
    items.some((item) => item.price?.id === priceId)
  await db
    .insert(shopEntitlements)
    .values({
      shopId: customer.shopId,
      diagnostics,
      stripePriceId: diagnostics ? priceId : null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: shopEntitlements.shopId,
      set: {
        diagnostics,
        stripePriceId: diagnostics ? priceId : null,
        updatedAt: new Date(),
      },
    })
}

export async function handleStripeWebhook(opts: {
  db: AppDb
  body: string
  signature: string | null
  secret: string | undefined
  constructEvent?: ConstructStripeEventFn
}): Promise<HandleStripeWebhookResult> {
  if (!opts.signature) {
    return { ok: false, status: 400, error: 'missing stripe-signature header' }
  }
  if (!opts.secret) {
    return { ok: false, status: 500, error: 'webhook secret not configured' }
  }
  const construct =
    opts.constructEvent ??
    ((b, s, sec) => stripe.webhooks.constructEvent(b, s, sec))
  let event: Stripe.Event
  try {
    event = construct(opts.body, opts.signature, opts.secret)
  } catch {
    return { ok: false, status: 400, error: 'invalid signature' }
  }
  if (SUBSCRIPTION_EVENT_TYPES.has(event.type)) {
    await applySubscriptionEvent(
      opts.db,
      event.data.object as Stripe.Subscription,
      event.type,
    )
  }
  return { ok: true, eventType: event.type }
}
