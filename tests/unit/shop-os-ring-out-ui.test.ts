import { describe, expect, it } from 'vitest'
import { parseRingOutResponse } from '@/lib/shop-os/ring-out-ui'

const TICKET = '00000000-0000-4000-8000-000000000020'

describe('ring-out UI contract', () => {
  it('accepts only the bounded receipt projection and rejects private or malformed fields', () => {
    const ringOut = {
      ticketId: TICKET,
      status: 'open',
      owed: { subtotalCents: 0, taxCents: 0, totalCents: 0, jobs: [] },
      paidCents: 0,
      balanceCents: 0,
      payments: [],
      canRecordPayment: false,
      canClose: true,
      closedAt: null,
    }

    expect(parseRingOutResponse({ ringOut })).toEqual(ringOut)
    expect(parseRingOutResponse({ ringOut: { ...ringOut, customerEmail: 'private@example.test' } })).toBeNull()
    expect(parseRingOutResponse({ ringOut: { ...ringOut, balanceCents: '0' } })).toBeNull()
    expect(parseRingOutResponse({ ringOut, extra: true })).toBeNull()
  })
})
