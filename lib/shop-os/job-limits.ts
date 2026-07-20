import { and, eq, sql } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { ticketJobs } from '@/lib/db/schema'

/** Matches the existing create-ticket maximum and bounds every later writer. */
export const MAX_TICKET_JOBS_PER_TICKET = 25

/** The caller must already hold the tenant-scoped ticket row lock. */
export async function ticketAtJobLimit(
  db: AppDb,
  input: { shopId: string; ticketId: string },
): Promise<boolean> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ticketJobs)
    .where(and(eq(ticketJobs.shopId, input.shopId), eq(ticketJobs.ticketId, input.ticketId)))
  return Number(row?.count ?? 0) >= MAX_TICKET_JOBS_PER_TICKET
}
