import { describe, it, expect, vi } from 'vitest'
import { handleStripeWebhook } from '@/lib/stripe'
import type { AppDb } from '@/lib/db/queries'

function makeFakeEvent(type = 'invoice.payment_succeeded') {
  return {
    id: 'evt_test',
    type,
    data: { object: { id: 'in_test' } },
  } as unknown as ReturnType<typeof JSON.parse>
}

// Failures short-circuit before any DB access; provide a stub the handler
// will never touch.
const stubDb = null as unknown as AppDb

describe('handleStripeWebhook', () => {
  it('returns 400 when stripe-signature header is missing', async () => {
    const result = await handleStripeWebhook({
      db: stubDb,
      body: '{}',
      signature: null,
      secret: 'whsec_test',
      constructEvent: () => makeFakeEvent(),
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/signature/i)
  })

  it('returns 500 when STRIPE_WEBHOOK_SECRET is not configured', async () => {
    const result = await handleStripeWebhook({
      db: stubDb,
      body: '{}',
      signature: 't=1,v1=abc',
      secret: undefined,
      constructEvent: () => makeFakeEvent(),
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.status).toBe(500)
    expect(result.error).toMatch(/secret/i)
  })

  it('returns 400 when signature verification throws', async () => {
    const result = await handleStripeWebhook({
      db: stubDb,
      body: '{}',
      signature: 't=1,v1=bogus',
      secret: 'whsec_test',
      constructEvent: () => {
        throw new Error('No signatures found matching the expected signature')
      },
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/invalid/i)
  })

  it('rejects a verified subscription event without durable ordering metadata', async () => {
    const result = await handleStripeWebhook({
      db: stubDb,
      body: '{}',
      signature: 't=1,v1=valid',
      secret: 'whsec_test',
      constructEvent: () => ({
        id: 'evt_missing_created',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_123', customer: 'cus_123', status: 'active' } },
      }) as never,
    })

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'invalid stripe event envelope',
    })
  })

  it('returns ok with the event type for non-subscription events', async () => {
    const construct = vi
      .fn()
      .mockReturnValue(makeFakeEvent('invoice.payment_succeeded'))
    const result = await handleStripeWebhook({
      db: stubDb,
      body: '{"id":"evt_test"}',
      signature: 't=1,v1=valid',
      secret: 'whsec_test',
      constructEvent: construct,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.eventType).toBe('invoice.payment_succeeded')
    expect(construct).toHaveBeenCalledWith(
      '{"id":"evt_test"}',
      't=1,v1=valid',
      'whsec_test',
    )
  })
})
