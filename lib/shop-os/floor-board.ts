import type { TodayTicketJob, TodayTicketJobs } from '@/lib/tickets'
import type { ReadyToCollectTicket } from '@/lib/shop-os/ready-to-collect'

// ---- Floor board -----------------------------------------------------------
//
// The wall display answers one question from twenty feet away: who owes the
// next move on each vehicle in the building. Today's lanes are cut by *who may
// act* (mine / open / team / parts); the floor's lanes are cut by *what is
// blocking*, which is the thing nobody is currently looking at.
//
// One row per vehicle, never per job. A truck on the lift with three jobs is
// one truck on the wall.
//
// Nothing here reads the database and nothing here is money or contact detail:
// the projection consumes exactly the server-authorized `listTodayTicketJobs`
// result the Today board already receives, so a wall in a semi-public bay can
// never show more than the signed-in operator's own board already does.

export type FloorLaneId = 'needs_tech' | 'held' | 'customer' | 'with_tech'

export type FloorRow = {
  /** Ticket id — stable across refreshes so React never re-creates a row. */
  key: string
  ticketNumber: number
  vehicle: string
  customer: string
  concern: string
  /** Right-hand column. Meaning is fixed per lane; see `rowRight`. */
  right: string
  attentionAt: string
}

export type FloorLane = {
  id: FloorLaneId
  label: string
  /** Every vehicle in the lane, including any the row budget could not seat. */
  total: number
  rows: FloorRow[]
  /** Vehicles summarised by the tail line instead of getting their own row. */
  overflow: number
}

export type FloorBoard = {
  lanes: FloorLane[]
  vehicleCount: number
  /** Rendered line count, tails included. Drives the fluid type scale. */
  visibleRows: number
  /** Below this the board has room for a second line of concern text. */
  dense: boolean
}

// The wall pays for a masthead and four lane labels before it seats a single
// vehicle, which leaves about 86vh spread over `rows + 3.6` weight units.
// Sixteen rows holds every line near 4.4vh — the point where a row still
// carries readable type on a 65" panel. Past sixteen the crowded lanes give
// their last line to a tail count instead of shrinking the whole wall.
export const FLOOR_ROW_BUDGET = 16
// Past four vehicles the concern line lands under 20px on a 65" panel, which
// is noise at ten feet rather than information. The board drops it and spends
// the height on the vehicle instead.
const DENSE_ROW_THRESHOLD = 4

const LANE_LABELS: Record<FloorLaneId, string> = {
  needs_tech: 'Needs a tech',
  held: 'Held',
  customer: 'Waiting on customer',
  with_tech: 'With a tech',
}

const LANE_ORDER: FloorLaneId[] = ['needs_tech', 'held', 'customer', 'with_tech']

const KIND_WORDS: Record<TodayTicketJob['kind'], string> = {
  diagnostic: 'DIAGNOSTIC',
  repair: 'REPAIR',
  maintenance: 'MAINTENANCE',
}

type TicketAggregate = {
  ticketId: string
  ticketNumber: number
  vehicle: string
  customer: string
  concern: string
  unassignedKind: TodayTicketJob['kind'] | null
  blocked: boolean
  quoteSent: boolean
  techName: string | null
  readyToCollect: boolean
  attentionAt: string
}

function newestAttentionAt(current: string, candidate: string): string {
  return Date.parse(candidate) > Date.parse(current) ? candidate : current
}

function displayVehicle(vehicle: TodayTicketJob['vehicle']): string {
  if (!vehicle) return 'Vehicle not set'
  return `${vehicle.year} ${vehicle.make} ${vehicle.model}`
}

function displayConcern(concern: string): string {
  return concern.replace(/\s+/g, ' ').trim()
}

function firstName(fullName: string): string {
  const [first] = fullName.trim().split(/\s+/)
  return first ?? fullName
}

function laneOf(ticket: TicketAggregate): FloorLaneId {
  // Most actionable-for-the-shop wins: a truck with one unclaimed job and one
  // blocked job is still a truck nobody has picked up.
  if (ticket.unassignedKind !== null) return 'needs_tech'
  if (ticket.blocked) return 'held'
  if (ticket.quoteSent || ticket.readyToCollect) return 'customer'
  return 'with_tech'
}

function rowRight(lane: FloorLaneId, ticket: TicketAggregate): string {
  switch (lane) {
    case 'needs_tech':
      return KIND_WORDS[ticket.unassignedKind ?? 'repair']
    case 'held':
      return ticket.techName ? firstName(ticket.techName) : 'HELD'
    case 'customer':
      return ticket.readyToCollect ? 'READY' : 'QUOTE SENT'
    case 'with_tech':
      return ticket.techName ? firstName(ticket.techName) : 'ASSIGNED'
  }
}

function foldJob(into: TicketAggregate, job: TodayTicketJob): void {
  into.attentionAt = newestAttentionAt(into.attentionAt, job.attentionAt)
  if (job.assignmentState === 'unassigned' && job.workStatus === 'open') {
    into.unassignedKind ??= job.kind
  }
  if (job.workStatus === 'blocked') into.blocked = true
  if (job.approvalState === 'sent') into.quoteSent = true
  if (job.assignedTechName && !into.techName) into.techName = job.assignedTechName
}

function emptyAggregate(
  source: { ticketId: string; ticketNumber: number; concern: string;
    customerName: string | null; vehicle: TodayTicketJob['vehicle']; attentionAt: string },
): TicketAggregate {
  return {
    ticketId: source.ticketId,
    ticketNumber: source.ticketNumber,
    vehicle: displayVehicle(source.vehicle),
    customer: source.customerName?.trim() || 'No customer on file',
    concern: displayConcern(source.concern),
    unassignedKind: null,
    blocked: false,
    quoteSent: false,
    techName: null,
    readyToCollect: false,
    attentionAt: source.attentionAt,
  }
}

/**
 * Seat every lane inside the row budget. Each non-empty lane keeps at least
 * one line so a lane never silently disappears; the rest is shared out by
 * largest remainder, and a lane that cannot seat all its vehicles gives its
 * last line to the tail count.
 */
export function allocateFloorRows(counts: number[], budget: number): number[] {
  const total = counts.reduce((sum, count) => sum + count, 0)
  if (total <= budget) return [...counts]

  const nonEmpty = counts.filter((count) => count > 0).length
  const shared = Math.max(0, budget - nonEmpty)
  const weights = counts.map((count) => Math.max(0, count - 1))
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0)

  const exact = weights.map((weight) => (weightTotal === 0 ? 0 : (weight * shared) / weightTotal))
  const extra = exact.map((value) => Math.floor(value))
  let remaining = shared - extra.reduce((sum, value) => sum + value, 0)
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder)
  for (const candidate of byRemainder) {
    if (remaining <= 0) break
    extra[candidate.index] += 1
    remaining -= 1
  }

  return counts.map((count, index) =>
    count === 0 ? 0 : Math.min(count, 1 + extra[index]))
}

export function projectFloorBoard(
  todayJobs: Pick<
    TodayTicketJobs,
    'myJobs' | 'openJobs' | 'createdJobs' | 'teamJobs' | 'partsJobs' | 'readyToCollect'
  >,
  options: { rowBudget?: number } = {},
): FloorBoard {
  const budget = options.rowBudget ?? FLOOR_ROW_BUDGET
  const seenJobs = new Set<string>()
  const tickets = new Map<string, TicketAggregate>()

  for (const job of [
    ...todayJobs.myJobs,
    ...todayJobs.openJobs,
    ...todayJobs.createdJobs,
    ...todayJobs.teamJobs,
    ...todayJobs.partsJobs,
  ]) {
    if (seenJobs.has(job.id)) continue
    seenJobs.add(job.id)
    let aggregate = tickets.get(job.ticketId)
    if (!aggregate) {
      aggregate = emptyAggregate(job)
      tickets.set(job.ticketId, aggregate)
    }
    foldJob(aggregate, job)
  }

  for (const card of todayJobs.readyToCollect as ReadyToCollectTicket[]) {
    // A finished repair order has no active job, so it can only reach the wall
    // from this list. Guard the merge anyway: never double-count a vehicle.
    const existing = tickets.get(card.ticketId)
    if (existing) {
      existing.readyToCollect = true
      existing.attentionAt = newestAttentionAt(existing.attentionAt, card.attentionAt)
      continue
    }
    const aggregate = emptyAggregate(card)
    aggregate.readyToCollect = true
    tickets.set(card.ticketId, aggregate)
  }

  const grouped = new Map<FloorLaneId, TicketAggregate[]>(
    LANE_ORDER.map((id) => [id, []]),
  )
  for (const ticket of tickets.values()) {
    grouped.get(laneOf(ticket))!.push(ticket)
  }
  for (const bucket of grouped.values()) {
    // Ticket-number order is stable, so a refresh never reshuffles the wall
    // under someone mid-read.
    bucket.sort((left, right) => left.ticketNumber - right.ticketNumber)
  }

  const counts = LANE_ORDER.map((id) => grouped.get(id)!.length)
  const seats = allocateFloorRows(counts, budget)

  const lanes: FloorLane[] = LANE_ORDER.map((id, index) => {
    const bucket = grouped.get(id)!
    const seated = seats[index]
    const shown = seated >= bucket.length ? bucket.length : Math.max(0, seated - 1)
    const rows = bucket.slice(0, shown).map((ticket) => ({
      key: ticket.ticketId,
      ticketNumber: ticket.ticketNumber,
      vehicle: ticket.vehicle,
      customer: ticket.customer,
      concern: ticket.concern,
      right: rowRight(id, ticket),
      attentionAt: ticket.attentionAt,
    }))
    return {
      id,
      label: LANE_LABELS[id],
      total: bucket.length,
      rows,
      overflow: bucket.length - rows.length,
    }
  })

  const visibleRows = lanes.reduce(
    (sum, lane) => sum + lane.rows.length + (lane.overflow > 0 ? 1 : 0),
    0,
  )

  return {
    lanes,
    vehicleCount: tickets.size,
    visibleRows,
    dense: visibleRows > DENSE_ROW_THRESHOLD,
  }
}

/** Height an empty lane keeps, in vh: its label and nothing else. */
export const FLOOR_EMPTY_LANE_VH = 4.6
/** Share of a lane's height spent on its label rather than a row. */
const LANE_LABEL_WEIGHT = 0.9

export type FloorLayout = {
  /** `grid-template-rows` for the lane stack. */
  tracks: string
  /** Total fr weight in play, so one row's height resolves to a single number. */
  weight: number
  /** Lanes billed at the fixed empty height instead of an fr share. */
  emptyLanes: number
}

/**
 * Lane heights carry the signal: a lane is as tall as the work piled in it, so
 * the spine down its left edge reads as a bar chart before a single word is
 * read. An empty lane collapses to its label — a quiet shop must not spend
 * two-thirds of the wall on three headings with nothing under them.
 */
export function floorLayout(board: FloorBoard): FloorLayout {
  let weight = 0
  let emptyLanes = 0
  const tracks = board.lanes.map((lane) => {
    const lines = lane.rows.length + (lane.overflow > 0 ? 1 : 0)
    if (lines === 0) {
      emptyLanes += 1
      return `${FLOOR_EMPTY_LANE_VH}vh`
    }
    const laneWeight = lines + LANE_LABEL_WEIGHT
    weight += laneWeight
    return `${laneWeight.toFixed(2)}fr`
  })
  return { tracks: tracks.join(' '), weight, emptyLanes }
}
