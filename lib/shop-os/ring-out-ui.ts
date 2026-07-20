import { z } from 'zod'
import type { TicketRingOut } from './ring-out'

const uuid = z.uuid().transform((value) => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true })
const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)

const ringOut = z.strictObject({
  ticketId: uuid,
  status: z.enum(['open', 'closed', 'canceled']),
  owed: z.strictObject({
    subtotalCents: money,
    taxCents: money,
    totalCents: money,
    jobs: z.array(z.strictObject({
      jobId: uuid,
      title: z.string().min(1).max(500),
      subtotalCents: money,
    })),
  }),
  paidCents: money,
  balanceCents: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  payments: z.array(z.strictObject({
    id: uuid,
    amountCents: money.min(1),
    method: z.enum(['cash', 'card', 'check', 'other']),
    note: z.string().max(500).nullable(),
    recordedAt: timestamp,
  })),
  canRecordPayment: z.boolean(),
  canClose: z.boolean(),
  closedAt: timestamp.nullable(),
})

export function parseRingOutResponse(value: unknown): TicketRingOut | null {
  const parsed = z.strictObject({ ringOut }).safeParse(value)
  return parsed.success ? parsed.data.ringOut : null
}
