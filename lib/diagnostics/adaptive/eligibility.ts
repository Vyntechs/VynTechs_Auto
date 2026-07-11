import { and, eq } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { sessions, ticketJobs, tickets } from '@/lib/db/schema'
import { isAdaptiveCanvasEnabled } from '@/lib/feature-flags'

export type AdaptiveEligibility =
  | { eligible: true; jobId: string; ticketId: string }
  | {
      eligible: false
      reason: 'flag_off' | 'not_ticket_backed' | 'not_diagnostic' | 'not_open'
    }

const ACTIVE_JOB_STATUSES = new Set(['open', 'in_progress', 'blocked'])

export async function getAdaptiveEligibility(
  db: AppDb,
  input: { sessionId: string; shopId: string },
): Promise<AdaptiveEligibility> {
  if (!isAdaptiveCanvasEnabled()) {
    return { eligible: false, reason: 'flag_off' }
  }

  const [linked] = await db
    .select({
      sessionStatus: sessions.status,
      jobId: ticketJobs.id,
      ticketId: ticketJobs.ticketId,
      jobKind: ticketJobs.kind,
      jobStatus: ticketJobs.workStatus,
      ticketStatus: tickets.status,
    })
    .from(sessions)
    .innerJoin(
      ticketJobs,
      and(
        eq(ticketJobs.sessionId, sessions.id),
        eq(ticketJobs.shopId, sessions.shopId),
      ),
    )
    .innerJoin(
      tickets,
      and(
        eq(tickets.id, ticketJobs.ticketId),
        eq(tickets.shopId, ticketJobs.shopId),
      ),
    )
    .where(and(
      eq(sessions.id, input.sessionId),
      eq(sessions.shopId, input.shopId),
    ))
    .limit(1)

  if (!linked) return { eligible: false, reason: 'not_ticket_backed' }
  if (linked.jobKind !== 'diagnostic') {
    return { eligible: false, reason: 'not_diagnostic' }
  }
  if (
    linked.sessionStatus !== 'open'
    || linked.ticketStatus !== 'open'
    || !ACTIVE_JOB_STATUSES.has(linked.jobStatus)
  ) {
    return { eligible: false, reason: 'not_open' }
  }

  return { eligible: true, jobId: linked.jobId, ticketId: linked.ticketId }
}
