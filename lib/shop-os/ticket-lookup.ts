import { and, desc, eq, or, sql, type SQLWrapper } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { customers, tickets, vehicles } from '@/lib/db/schema'
import { boundedSearchTokens, literalLikeToken } from '@/lib/intake/search-limits'
import { isShopRole } from '@/lib/shop-os/capabilities'
import type { TicketActor } from '@/lib/tickets'

// ---- Repair order lookup ---------------------------------------------------
//
// Today carries active work and, since the `Ready to collect` lane, finished
// work that still owes money. The moment a repair order closes it leaves the
// board entirely, and the only ways back are a deep link somebody already has
// or the vehicle page. That makes closed work effectively unfindable at the
// counter, which is exactly what a customer walking back in needs.
//
// This is a read projection over existing tables. It deliberately carries no
// money: a balance belongs to the ring-out path, which is already gated on
// `canCloseTickets`. Every active member of the shop can already open a repair
// order they have the id for, so the lookup is available to the same set —
// finding one is not a wider permission than reading it.

export const TICKET_LOOKUP_LIMIT = 10

export type TicketLookupHit = {
  ticketId: string
  ticketNumber: number
  status: 'open' | 'closed' | 'canceled'
  concern: string
  customerName: string | null
  vehicle: { year: number; make: string; model: string } | null
  openedAt: Date
  closedAt: Date | null
}

const containsLiteral = (column: SQLWrapper, token: string) =>
  sql<boolean>`${column} ILIKE ${`%${literalLikeToken(token)}%`} ESCAPE '!'`

/**
 * The number gets written and spoken several ways — `12`, `#12`, `RO 12`,
 * `RO#12`. Fold the ornament away before tokenizing so all of them are the one
 * token that matters.
 */
function normalizeQuery(q: string): string {
  return q.replace(/\bro\b\s*#?\s*(?=\d)/gi, '').replace(/#\s*(?=\d)/g, '')
}

/**
 * A counter query is usually one of three things: the number on the paper, the
 * person, or the vehicle in the lot. Digits are read as a repair order number
 * so a shop saying "twelve" gets RO 12. Ten-digit strings stay text only, so a
 * full phone number still finds its customer.
 */
function ticketNumberFromToken(token: string): number | null {
  if (!/^\d{1,9}$/.test(token)) return null
  const parsed = Number.parseInt(token, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export async function lookupTickets(
  db: AppDb,
  input: { actor: TicketActor; q: string },
): Promise<TicketLookupHit[]> {
  const { actor } = input
  if (
    !actor.shopId ||
    actor.membershipStatus !== 'active' ||
    actor.deactivatedAt ||
    !isShopRole(actor.role)
  ) {
    return []
  }

  const tokens = boundedSearchTokens(normalizeQuery(input.q))
  if (tokens.length === 0) return []

  // Every token has to match something, so adding a word narrows the result
  // the way a person expects rather than widening it.
  const conditions = tokens.map((token) => {
    const ticketNumber = ticketNumberFromToken(token)
    return or(
      ...(ticketNumber === null ? [] : [eq(tickets.ticketNumber, ticketNumber)]),
      containsLiteral(customers.name, token),
      // A short run of digits is a repair order number or part of a vehicle —
      // `3500`, `F150`, `250`. It is never a useful slice of a phone number,
      // and letting it be one made every customer's whole history match.
      ...(ticketNumber === null ? [containsLiteral(customers.phone, token)] : []),
      containsLiteral(vehicles.plate, token),
      containsLiteral(vehicles.vin, token),
      containsLiteral(vehicles.make, token),
      containsLiteral(vehicles.model, token),
    )
  })

  const rows = await db
    .select({
      ticketId: tickets.id,
      ticketNumber: tickets.ticketNumber,
      status: tickets.status,
      concern: tickets.concern,
      customerName: customers.name,
      vehicleYear: vehicles.year,
      vehicleMake: vehicles.make,
      vehicleModel: vehicles.model,
      openedAt: tickets.createdAt,
      closedAt: tickets.closedAt,
    })
    .from(tickets)
    .leftJoin(customers, eq(tickets.customerId, customers.id))
    .leftJoin(vehicles, eq(tickets.vehicleId, vehicles.id))
    .where(and(eq(tickets.shopId, actor.shopId), ...conditions))
    .orderBy(desc(tickets.ticketNumber))
    .limit(TICKET_LOOKUP_LIMIT)

  return rows.map((row) => ({
    ticketId: row.ticketId,
    ticketNumber: row.ticketNumber,
    status: row.status,
    concern: row.concern,
    customerName: row.customerName,
    vehicle:
      row.vehicleYear !== null && row.vehicleMake !== null && row.vehicleModel !== null
        ? { year: row.vehicleYear, make: row.vehicleMake, model: row.vehicleModel }
        : null,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
  }))
}
