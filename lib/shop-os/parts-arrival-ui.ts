import { z } from 'zod'

const uuid = z.uuid().transform((value) => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true })
const quantity = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/).refine((value) => Number(value) > 0)
const action = z.enum(['mark_ordered', 'mark_received'])
const state = z.enum(['needs_order', 'ordered', 'received'])
const receipt = z.strictObject({
  actorName: z.string().trim().min(1).max(200).nullable(),
  at: timestamp,
})

const line = z.strictObject({
  id: uuid,
  description: z.string().trim().min(1).max(500),
  quantity,
  partNumber: z.string().max(200).nullable(),
  brand: z.string().max(200).nullable(),
  state,
  nextAction: action.nullable(),
  ordered: receipt.nullable(),
  received: receipt.nullable(),
})

const job = z.strictObject({
  jobId: uuid,
  approvedQuoteVersionId: uuid,
  title: z.string().trim().min(1).max(200),
  readOnly: z.boolean(),
  receivedCount: z.number().int().min(0).max(100),
  totalCount: z.number().int().min(1).max(100),
  allHere: z.boolean(),
  lines: z.array(line).min(1).max(100),
}).superRefine((value, context) => {
  const unique = new Set(value.lines.map((item) => item.id))
  const received = value.lines.filter((item) => item.state === 'received').length
  if (unique.size !== value.lines.length
    || value.totalCount !== value.lines.length
    || value.receivedCount !== received
    || value.allHere !== (received === value.lines.length)) {
    context.addIssue({ code: 'custom', message: 'parts arrival summary is inconsistent' })
  }
  for (const item of value.lines) {
    const expected = value.readOnly || item.state === 'received'
      ? null
      : item.state === 'needs_order' ? 'mark_ordered' : 'mark_received'
    if (item.nextAction !== expected) {
      context.addIssue({ code: 'custom', message: 'parts arrival action is inconsistent' })
    }
    if (item.state === 'needs_order' && (item.ordered || item.received)) {
      context.addIssue({ code: 'custom', message: 'unstarted part cannot have receipts' })
    }
    if (item.state === 'ordered' && (!item.ordered || item.received)) {
      context.addIssue({ code: 'custom', message: 'ordered part receipts are inconsistent' })
    }
    if (item.state === 'received' && item.received && !item.ordered) {
      context.addIssue({ code: 'custom', message: 'received part cannot omit its order receipt' })
    }
  }
})

export type PartsArrivalJobView = z.infer<typeof job>

export function parsePartsArrivalReadResponse(value: unknown): PartsArrivalJobView | null {
  const parsed = z.strictObject({ job }).safeParse(value)
  return parsed.success ? parsed.data.job : null
}
export function parsePartsArrivalMutationResponse(value: unknown): {
  changed: boolean
  job: PartsArrivalJobView
} | null {
  const parsed = z.strictObject({ changed: z.boolean(), job }).safeParse(value)
  return parsed.success ? parsed.data : null
}
