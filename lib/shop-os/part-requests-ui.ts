import { z } from 'zod'

const uuid = z.uuid().transform((value) => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true })

const partRequest = z.strictObject({
  id: uuid,
  jobId: uuid,
  description: z.string().min(1).max(200),
  preference: z.string().max(200).nullable(),
  quantity: z.number().int().min(1).max(99),
  status: z.enum(['requested', 'sourced', 'dismissed']),
  requestedAt: timestamp,
  resolvedAt: timestamp.nullable(),
})

export type PartRequestView = z.infer<typeof partRequest>
export type TicketPartRequestView = PartRequestView & {
  jobTitle: string
  requestedByName: string | null
}

// Parses the `{ request }` body returned by both the create and resolve routes.
export function parsePartRequestResponse(value: unknown): PartRequestView | null {
  const parsed = z.strictObject({ request: partRequest }).safeParse(value)
  return parsed.success ? parsed.data.request : null
}

export function parsePartRequestListResponse(value: unknown): PartRequestView[] | null {
  const parsed = z.strictObject({ requests: z.array(partRequest).max(100) }).safeParse(value)
  return parsed.success ? parsed.data.requests : null
}
