import { z } from 'zod'
import { calculateTicketTotals } from '@/lib/shop-os/quote-math'

const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const story = z.strictObject({
  whatYouToldUs: z.string(),
  whatWeFound: z.string(),
  howWeKnow: z.array(z.strictObject({
    claim: z.string(),
  })),
  whatItMeansIfWaived: z.string(),
  whatWeRecommend: z.string(),
})
const quoteSchema = z.strictObject({
  quote: z.strictObject({
    shop: z.strictObject({ name: z.string().min(1), phone: z.string().nullable() }),
    customer: z.strictObject({ name: z.string().min(1) }),
    vehicle: z.strictObject({
      year: z.number().int().nullable(),
      make: z.string().nullable(),
      model: z.string().nullable(),
    }),
    ticketNumber: z.number().int().positive(),
    versionNumber: z.number().int().positive(),
    expiresAt: z.iso.datetime(),
    jobs: z.array(z.strictObject({
      id: z.uuid(),
      title: z.string().min(1),
      story: story.nullable(),
      lines: z.array(z.strictObject({
        kind: z.enum(['part', 'labor', 'fee']),
        description: z.string().min(1),
        quantity: z.string().min(1),
        priceCents: money,
      })).min(1),
      subtotalCents: money,
      taxableSubtotalCents: money,
    })).min(1).superRefine((jobs, context) => {
      if (new Set(jobs.map((job) => job.id)).size !== jobs.length) {
        context.addIssue({ code: 'custom', message: 'job IDs must be unique' })
      }
    }),
    totals: z.strictObject({ subtotalCents: money, taxCents: money, totalCents: money }),
    taxRateBps: z.number().int().min(0).max(10_000),
  }),
})
const receiptSchema = z.strictObject({
  changed: z.boolean(),
  receipt: z.strictObject({
    versionNumber: z.number().int().positive(),
    decisions: z.array(z.strictObject({
      jobId: z.uuid(),
      decision: z.enum(['approved', 'declined']),
    })).min(1),
    approvedTotalCents: money,
  }),
})
const approvalLinkSchema = z.strictObject({
  changed: z.boolean(),
  link: z.strictObject({
    id: z.uuid(),
    quoteVersionId: z.uuid(),
    versionNumber: z.number().int().positive(),
    expiresAt: z.iso.datetime(),
  }),
})

export type CustomerApprovalQuote = z.infer<typeof quoteSchema>['quote']
export type CustomerApprovalReceipt = z.infer<typeof receiptSchema>['receipt']
export type CustomerApprovalLink = z.infer<typeof approvalLinkSchema>['link']
export type CustomerApprovalDecision = CustomerApprovalReceipt['decisions'][number]

export function parseCustomerApprovalQuote(status: number, value: unknown): CustomerApprovalQuote | null {
  if (status !== 200) return null
  const parsed = quoteSchema.safeParse(value)
  return parsed.success ? parsed.data.quote : null
}

export function parseCustomerApprovalReceipt(
  status: number,
  value: unknown,
  quote: CustomerApprovalQuote,
  submitted: readonly CustomerApprovalDecision[],
): CustomerApprovalReceipt | null {
  if (status !== 200 && status !== 201) return null
  const parsed = receiptSchema.safeParse(value)
  if (!parsed.success || (status === 201) !== parsed.data.changed) return null
  const receipt = parsed.data.receipt
  if (receipt.versionNumber !== quote.versionNumber) return null
  const quoteIds = quote.jobs.map((job) => job.id)
  const submittedIds = submitted.map((item) => item.jobId)
  const receivedIds = receipt.decisions.map((item) => item.jobId)
  if (new Set(quoteIds).size !== quoteIds.length
    || new Set(submittedIds).size !== submittedIds.length
    || new Set(receivedIds).size !== receivedIds.length
    || submittedIds.length !== quoteIds.length
    || receivedIds.length !== quoteIds.length
    || quoteIds.some((jobId) => !submittedIds.includes(jobId) || !receivedIds.includes(jobId))) return null
  if (receipt.decisions.some((item) => (
    submitted.find((decision) => decision.jobId === item.jobId)?.decision !== item.decision
  ))) return null
  const choices = Object.fromEntries(submitted.map((item) => [item.jobId, item.decision]))
  if (receipt.approvedTotalCents !== selectedApprovalTotal(quote, choices)) return null
  return receipt
}

export function parseCustomerApprovalLink(
  status: number,
  value: unknown,
): CustomerApprovalLink | null {
  if (status !== 200 && status !== 201) return null
  const parsed = approvalLinkSchema.safeParse(value)
  if (!parsed.success) return null
  if ((status === 201) !== parsed.data.changed) return null
  return parsed.data.link
}

export async function createCustomerApprovalSecret(): Promise<{
  rawToken: string
  tokenHash: string
} | null> {
  if (!globalThis.crypto?.getRandomValues || !globalThis.crypto?.subtle) return null
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  const rawToken = globalThis.btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(rawToken),
  ))
  const tokenHash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return rawToken.length === 43 && tokenHash.length === 64 ? { rawToken, tokenHash } : null
}

export function selectedApprovalTotal(
  quote: CustomerApprovalQuote,
  decisions: Readonly<Record<string, 'approved' | 'declined'>>,
): number {
  return calculateTicketTotals(
    quote.jobs
      .filter((job) => decisions[job.id] === 'approved')
      .flatMap((job) => [
        { extendedCents: job.taxableSubtotalCents, taxable: true },
        { extendedCents: job.subtotalCents - job.taxableSubtotalCents, taxable: false },
      ])
      .filter((line) => line.extendedCents > 0),
    quote.taxRateBps,
  ).totalCents
}
