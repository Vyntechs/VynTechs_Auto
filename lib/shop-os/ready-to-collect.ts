import { and, asc, eq, exists, inArray, not } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { customers, ticketJobs, tickets, vehicles } from '@/lib/db/schema'
import { canCloseTickets } from '@/lib/shop-os/capabilities'
import { getTicketRingOut, type TicketRingOut } from '@/lib/shop-os/ring-out'
import type { TicketActor } from '@/lib/tickets'

// ---- Ready to collect ------------------------------------------------------
//
// Today's job lanes only carry active work, so a repair order whose every job
// has finished used to vanish from the board while it was still open and still
// owed money. This projection keeps exactly those repair orders findable, as
// one card per repair order rather than one per job.
//
// Terminal means the same thing here as it does to `closeTicket`: no job left
// in 'open', 'in_progress', or 'blocked'. Using a narrower rule would hide a
// repair order that the close path would happily close, which is the very
// stranding this row exists to fix. A repair order with no jobs at all is not
// ready for anything — it is an intake still being built — so at least one job
// is required, matching the `allWorkTerminal` rule the mounted workspace
// already uses.
//
// The money is never recomputed here. Each card carries the exact
// `getTicketRingOut` result, and the whole projection is empty for anyone who
// cannot close tickets, so a technician's Today never contains a balance.

const ACTIVE_WORK_STATUSES = ['open', 'in_progress', 'blocked'] as const

export const READY_TO_COLLECT_LIMIT = 25

export type ReadyToCollectTicket = {
  ticketId: string
  ticketNumber: number
  concern: string
  customerName: string | null
  vehicle: { year: number; make: string; model: string } | null
  ringOut: TicketRingOut
}

export async function listReadyToCollectTickets(
  db: AppDb,
  input: { actor: TicketActor },
): Promise<ReadyToCollectTicket[]> {
  const { actor } = input
  if (
    !actor.shopId ||
    actor.membershipStatus !== 'active' ||
    actor.deactivatedAt ||
    !canCloseTickets(actor.role)
  ) {
    return []
  }
  const shopId = actor.shopId

  const hasAnyJob = exists(
    db.select({ id: ticketJobs.id })
      .from(ticketJobs)
      .where(and(
        eq(ticketJobs.shopId, shopId),
        eq(ticketJobs.ticketId, tickets.id),
      )),
  )
  const hasActiveJob = exists(
    db.select({ id: ticketJobs.id })
      .from(ticketJobs)
      .where(and(
        eq(ticketJobs.shopId, shopId),
        eq(ticketJobs.ticketId, tickets.id),
        inArray(ticketJobs.workStatus, [...ACTIVE_WORK_STATUSES]),
      )),
  )

  const rows = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      concern: tickets.concern,
      customerName: customers.name,
      vehicleYear: vehicles.year,
      vehicleMake: vehicles.make,
      vehicleModel: vehicles.model,
    })
    .from(tickets)
    .leftJoin(customers, eq(tickets.customerId, customers.id))
    .leftJoin(vehicles, eq(tickets.vehicleId, vehicles.id))
    .where(and(
      eq(tickets.shopId, shopId),
      eq(tickets.status, 'open'),
      hasAnyJob,
      not(hasActiveJob),
    ))
    .orderBy(asc(tickets.ticketNumber))
    .limit(READY_TO_COLLECT_LIMIT)

  // The bill stays the audited one. Reusing `getTicketRingOut` per card keeps a
  // single money code path at the cost of a bounded fan-out; a shop has only a
  // handful of repair orders waiting at the counter at once.
  const cards = await Promise.all(rows.map(async (row) => {
    const result = await getTicketRingOut(db, { actor, ticketId: row.id })
    if (!result.ok) return null
    return {
      ticketId: row.id,
      ticketNumber: row.ticketNumber,
      concern: row.concern,
      customerName: row.customerName,
      vehicle:
        row.vehicleYear !== null && row.vehicleMake !== null && row.vehicleModel !== null
          ? { year: row.vehicleYear, make: row.vehicleMake, model: row.vehicleModel }
          : null,
      ringOut: result.ringOut,
    }
  }))

  return cards.filter((card): card is ReadyToCollectTicket => card !== null)
}
