import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FloorBoard } from '@/components/screens/floor-board'
import {
  FLOOR_ROW_BUDGET,
  allocateFloorRows,
  floorLayout,
  projectFloorBoard,
} from '@/lib/shop-os/floor-board'
import type { TodayTicketJob, TodayTicketJobs } from '@/lib/tickets'

function job(overrides: Partial<TodayTicketJob> & { id: string; ticketId: string }): TodayTicketJob {
  return {
    ticketNumber: 1,
    concern: 'Customer states engine ticking cold and hot at times.',
    customerName: 'Drew Gramh',
    vehicle: { year: 2021, make: 'Ram', model: '2500' },
    title: 'Diagnostic',
    kind: 'diagnostic',
    requiredSkillTier: 2,
    sessionId: null,
    workStatus: 'open',
    clockedOnSince: null,
    approvalState: 'pending_quote',
    canClaim: false,
    assignmentState: 'unassigned',
    assignedTechName: null,
    createdByMe: false,
    attentionAt: '2026-08-02T17:18:00.000Z',
    ...overrides,
  }
}

function todayJobs(overrides: Partial<TodayTicketJobs> = {}): TodayTicketJobs {
  return {
    myJobs: [],
    openJobs: [],
    createdJobs: [],
    teamJobs: [],
    partsJobs: [],
    readyToCollect: [],
    linkedSessionIds: [],
    ...overrides,
  }
}

const onlyTicket = todayJobs({
  openJobs: [job({ id: 'job-1', ticketId: 'ticket-1', ticketNumber: 1 })],
})

function fullBoard(vehicleCount: number): TodayTicketJobs {
  const openJobs: TodayTicketJob[] = []
  const teamJobs: TodayTicketJob[] = []
  for (let index = 0; index < vehicleCount; index += 1) {
    const shared = {
      id: `job-${index}`,
      ticketId: `ticket-${index}`,
      ticketNumber: index + 1,
      customerName: `Customer ${index}`,
      vehicle: { year: 2018, make: 'Ford', model: 'F-250' },
    }
    if (index % 4 === 0) {
      openJobs.push(job(shared))
    } else if (index % 4 === 1) {
      teamJobs.push(job({
        ...shared,
        workStatus: 'blocked',
        assignmentState: 'team',
        assignedTechName: 'Marcus Webb',
      }))
    } else if (index % 4 === 2) {
      teamJobs.push(job({
        ...shared,
        approvalState: 'sent',
        assignmentState: 'team',
        assignedTechName: 'Rosa Lane',
      }))
    } else {
      teamJobs.push(job({
        ...shared,
        workStatus: 'in_progress',
        assignmentState: 'team',
        assignedTechName: 'Kyle Ortiz',
      }))
    }
  }
  return todayJobs({ openJobs, teamJobs })
}

describe('projectFloorBoard', () => {
  it('collapses a ticket with several jobs into one vehicle row', () => {
    const board = projectFloorBoard(todayJobs({
      myJobs: [
        job({ id: 'job-a', ticketId: 'ticket-1', assignmentState: 'mine',
          assignedTechName: 'Kyle Ortiz', workStatus: 'in_progress' }),
        job({ id: 'job-b', ticketId: 'ticket-1', assignmentState: 'mine',
          assignedTechName: 'Kyle Ortiz', workStatus: 'in_progress', kind: 'repair' }),
      ],
    }))

    expect(board.vehicleCount).toBe(1)
    expect(board.lanes.find((lane) => lane.id === 'with_tech')?.rows).toHaveLength(1)
  })

  it('keeps the newest job change when several jobs share one vehicle', () => {
    const board = projectFloorBoard(todayJobs({
      myJobs: [
        job({ id: 'job-a', ticketId: 'ticket-1', assignmentState: 'mine',
          assignedTechName: 'Kyle Ortiz', attentionAt: '2026-08-01T09:00:00.000Z' }),
        job({ id: 'job-b', ticketId: 'ticket-1', assignmentState: 'mine',
          assignedTechName: 'Kyle Ortiz', attentionAt: '2026-08-02T17:18:00.000Z' }),
      ],
    }))

    expect(board.lanes.find((lane) => lane.id === 'with_tech')?.rows[0]?.attentionAt)
      .toBe('2026-08-02T17:18:00.000Z')
  })

  it('sorts each vehicle by what is blocking it, unclaimed work first', () => {
    const board = projectFloorBoard(todayJobs({
      openJobs: [job({ id: 'j1', ticketId: 't1', ticketNumber: 1 })],
      teamJobs: [
        job({ id: 'j2', ticketId: 't2', ticketNumber: 2, workStatus: 'blocked',
          assignmentState: 'team', assignedTechName: 'Marcus Webb' }),
        job({ id: 'j3', ticketId: 't3', ticketNumber: 3, approvalState: 'sent',
          assignmentState: 'team', assignedTechName: 'Rosa Lane' }),
        job({ id: 'j4', ticketId: 't4', ticketNumber: 4, workStatus: 'in_progress',
          assignmentState: 'team', assignedTechName: 'Kyle Ortiz' }),
      ],
    }))

    expect(board.lanes.map((lane) => [lane.id, lane.total])).toEqual([
      ['needs_tech', 1],
      ['held', 1],
      ['customer', 1],
      ['with_tech', 1],
    ])
  })

  it('keeps a vehicle unclaimed even when another of its jobs is blocked', () => {
    const board = projectFloorBoard(todayJobs({
      openJobs: [job({ id: 'j1', ticketId: 't1' })],
      teamJobs: [job({ id: 'j2', ticketId: 't1', workStatus: 'blocked',
        assignmentState: 'team', assignedTechName: 'Marcus Webb' })],
    }))

    expect(board.lanes.find((lane) => lane.id === 'needs_tech')?.total).toBe(1)
    expect(board.lanes.find((lane) => lane.id === 'held')?.total).toBe(0)
  })

  it('places a finished repair order under waiting on customer without money', () => {
    const board = projectFloorBoard(todayJobs({
      readyToCollect: [{
        ticketId: 'ticket-9',
        ticketNumber: 9,
        concern: 'Brake job complete',
        customerName: 'Ana Diaz',
        vehicle: { year: 2016, make: 'Ford', model: 'F-350' },
        attentionAt: '2026-08-01T14:00:00.000Z',
        ringOut: {
          status: 'open',
          totalCents: 120_000,
          paidCents: 0,
          balanceCents: 120_000,
        } as never,
      }],
    }))

    const lane = board.lanes.find((entry) => entry.id === 'customer')
    expect(lane?.rows[0]?.right).toBe('READY')
    expect(lane?.rows[0]?.attentionAt).toBe('2026-08-01T14:00:00.000Z')
    expect(JSON.stringify(board)).not.toContain('120000')
  })
})

describe('allocateFloorRows', () => {
  it('seats every lane untouched when the board fits', () => {
    expect(allocateFloorRows([1, 0, 0, 0], FLOOR_ROW_BUDGET)).toEqual([1, 0, 0, 0])
    expect(allocateFloorRows([4, 3, 2, 5], FLOOR_ROW_BUDGET)).toEqual([4, 3, 2, 5])
  })

  it('never spends more than the budget and never drops a non-empty lane', () => {
    const seats = allocateFloorRows([8, 4, 6, 12], FLOOR_ROW_BUDGET)
    expect(seats.reduce((sum, seat) => sum + seat, 0)).toBeLessThanOrEqual(FLOOR_ROW_BUDGET)
    for (const seat of seats) expect(seat).toBeGreaterThanOrEqual(1)
  })
})

describe('FloorBoard rendering', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 500 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('fills the wall with the one vehicle in the building', () => {
    const { container } = render(<FloorBoard shopName="Young Motorsports" todayJobs={onlyTicket} />)

    expect(screen.getByText('2021 Ram 2500')).toBeTruthy()
    expect(container.querySelector('[class*="countNumber"]')?.textContent).toBe('1')
    expect(screen.getByText('vehicle in the building')).toBeTruthy()
    // The concern earns its line only while the board is quiet — this is what
    // keeps n=1 from reading as three-quarters of an empty wall.
    expect(screen.getByText(/engine ticking cold and hot/i)).toBeTruthy()

    const board = projectFloorBoard(onlyTicket)
    expect(board.dense).toBe(false)
    expect(board.visibleRows).toBe(1)
    // One lane holds everything; the other three collapse to their label so a
    // quiet shop never shows a wall of empty headings.
    const layout = floorLayout(board)
    expect(layout.tracks).toBe('1.90fr 4.6vh 4.6vh 4.6vh')
    expect(layout.emptyLanes).toBe(3)
    expect(layout.weight).toBeCloseTo(1.9)
  })

  it('shows the newest vehicle quiet time and automatically ages it on the existing wall clock', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-02T18:00:00.000Z'))
    const board = todayJobs({
      openJobs: [
        job({ id: 'job-recent', ticketId: 'ticket-recent', ticketNumber: 41 }),
        job({
          id: 'job-stale',
          ticketId: 'ticket-stale',
          ticketNumber: 42,
          vehicle: { year: 2016, make: 'Ford', model: 'F-350' },
          attentionAt: '2026-07-30T18:00:00.000Z',
        }),
      ],
    })

    const { container } = render(<FloorBoard shopName="Young Motorsports" todayJobs={board} />)
    const recentRow = container.querySelector('[data-ticket-id="ticket-recent"]')
    const staleRow = container.querySelector('[data-ticket-id="ticket-stale"]')
    expect(recentRow).not.toBeNull()
    expect(staleRow).not.toBeNull()
    expect(within(recentRow as HTMLElement).getByText('Quiet 42m'))
      .toHaveAttribute('data-attention', 'normal')
    expect(within(staleRow as HTMLElement).getByText('Quiet 3d'))
      .toHaveAttribute('data-attention', 'stale')

    act(() => { vi.advanceTimersByTime(60_000) })
    expect(within(recentRow as HTMLElement).getByText('Quiet 43m')).toBeTruthy()
  })

  it('holds a thirty-vehicle shop inside the row budget without overflowing', () => {
    const busy = fullBoard(30)
    const board = projectFloorBoard(busy)

    expect(board.vehicleCount).toBe(30)
    expect(board.visibleRows).toBeLessThanOrEqual(FLOOR_ROW_BUDGET)
    expect(board.dense).toBe(true)

    const { container } = render(<FloorBoard shopName="Young Motorsports" todayJobs={busy} />)
    const rendered = container.querySelectorAll('[class*="row"]').length
    expect(rendered).toBeLessThanOrEqual(FLOOR_ROW_BUDGET)
    // Nothing is silently dropped: every unseated vehicle is counted in a tail.
    const tailed = board.lanes.reduce((sum, lane) => sum + lane.rows.length + lane.overflow, 0)
    expect(tailed).toBe(30)
    expect(screen.getAllByText(/^\+\d+ more$/).length).toBeGreaterThan(0)
  })

  it('never lets the lane tracks exceed the space the row budget assumes', () => {
    const layout = floorLayout(projectFloorBoard(fullBoard(30)))
    expect(layout.emptyLanes).toBe(0)
    expect(layout.weight).toBeLessThanOrEqual(FLOOR_ROW_BUDGET + 3.6)
  })

  it('starts one refresh timer and clears it on unmount', () => {
    vi.useFakeTimers()
    const setInterval = vi.spyOn(window, 'setInterval')
    const clearInterval = vi.spyOn(window, 'clearInterval')

    const view = render(
      <FloorBoard shopName="Young Motorsports" todayJobs={onlyTicket} refreshMs={5_000} />,
    )
    // One data poll plus one clock tick.
    expect(setInterval).toHaveBeenCalledTimes(2)
    expect(setInterval.mock.calls.some(([, ms]) => ms === 5_000)).toBe(true)

    act(() => { vi.advanceTimersByTime(15_000) })
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/today/jobs', expect.anything())
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3)

    view.unmount()
    expect(clearInterval).toHaveBeenCalledTimes(2)
  })

  it('keeps showing the last true board when a refresh fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('shop wifi dropped') }))
    render(<FloorBoard shopName="Young Motorsports" todayJobs={onlyTicket} refreshMs={5_000} />)

    await vi.waitFor(() => expect(screen.getByText('2021 Ram 2500')).toBeTruthy())
  })

  it('says so plainly when nothing is in the building', () => {
    render(<FloorBoard shopName="Young Motorsports" todayJobs={todayJobs()} />)
    expect(screen.getByText('No open work')).toBeTruthy()
  })
})

describe('floor board styling', () => {
  const css = readFileSync(
    resolve(process.cwd(), 'components/screens/floor-board.module.css'),
    'utf8',
  )

  it('is a dark, fluid, non-scrolling canvas', () => {
    expect(css).toContain('background: var(--vt-graphite-1000)')
    expect(css).toContain('height: 100dvh')
    expect(css).toContain('overflow: hidden')
    expect(css).not.toMatch(/width:\s*1920px/)
  })
})
