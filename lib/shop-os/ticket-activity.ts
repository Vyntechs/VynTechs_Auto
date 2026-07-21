import { and, eq } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import {
  ticketActivity,
  type TICKET_ACTIVITY_KINDS,
} from '@/lib/db/schema'

export type TicketActivityKind = (typeof TICKET_ACTIVITY_KINDS)[number]

export type TicketActivityWrite = {
  shopId: string
  ticketId: string
  jobId?: string | null
  actorProfileId: string
  kind: TicketActivityKind
  requestKey: string
  payload: Record<string, unknown>
}

export type TicketActivityWriteResult =
  | { ok: true; created: boolean }
  | { ok: false; error: 'conflict' }

function samePayload(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('ticket activity payload must be JSON')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    )).join(',')}}`
  }
  throw new TypeError('ticket activity payload must be JSON')
}

function matches(existing: typeof ticketActivity.$inferSelect, input: TicketActivityWrite): boolean {
  return existing.ticketId === input.ticketId
    && existing.jobId === (input.jobId ?? null)
    && existing.actorProfileId === input.actorProfileId
    && existing.kind === input.kind
    && samePayload(existing.payload, input.payload)
}

export async function appendTicketActivity(
  db: AppDb,
  input: TicketActivityWrite,
): Promise<TicketActivityWriteResult> {
  const [existing] = await db
    .select()
    .from(ticketActivity)
    .where(and(
      eq(ticketActivity.shopId, input.shopId),
      eq(ticketActivity.requestKey, input.requestKey),
    ))
    .limit(1)
  if (existing) return matches(existing, input)
    ? { ok: true, created: false }
    : { ok: false, error: 'conflict' }

  try {
    await db.insert(ticketActivity).values({
      shopId: input.shopId,
      ticketId: input.ticketId,
      jobId: input.jobId ?? null,
      actorProfileId: input.actorProfileId,
      kind: input.kind,
      requestKey: input.requestKey,
      payload: input.payload,
    })
    return { ok: true, created: true }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    const [winner] = await db
      .select()
      .from(ticketActivity)
      .where(and(
        eq(ticketActivity.shopId, input.shopId),
        eq(ticketActivity.requestKey, input.requestKey),
      ))
      .limit(1)
    return winner && matches(winner, input)
      ? { ok: true, created: false }
      : { ok: false, error: 'conflict' }
  }
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === 'object' && 'code' in current && current.code === '23505') return true
    current = typeof current === 'object' && 'cause' in current ? current.cause : null
  }
  return false
}
