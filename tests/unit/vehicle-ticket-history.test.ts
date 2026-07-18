import { describe, it, expect } from 'vitest'
import { groupVehicleHistoryRows, type VehicleHistoryRow } from '@/lib/tickets'

function row(over: Partial<VehicleHistoryRow>): VehicleHistoryRow {
  return {
    ticketId: 't1',
    ticketNumber: 1,
    concern: 'noise',
    status: 'closed',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    closedAt: null,
    jobId: null,
    jobTitle: null,
    jobKind: null,
    jobApprovalState: null,
    jobWorkStatus: null,
    ...over,
  }
}

describe('groupVehicleHistoryRows', () => {
  it('groups job rows under their ticket, preserving row order', () => {
    const rows = [
      row({ ticketId: 't2', ticketNumber: 2, jobId: 'j1', jobTitle: 'Brakes', jobKind: 'repair', jobApprovalState: 'declined', jobWorkStatus: 'open' }),
      row({ ticketId: 't2', ticketNumber: 2, jobId: 'j2', jobTitle: 'Oil', jobKind: 'maintenance', jobApprovalState: 'approved', jobWorkStatus: 'done' }),
      row({ ticketId: 't1', ticketNumber: 1, jobId: 'j3', jobTitle: 'Diag', jobKind: 'diagnostic', jobApprovalState: 'approved', jobWorkStatus: 'done' }),
    ]

    const grouped = groupVehicleHistoryRows(rows)

    expect(grouped.map((t) => t.ticketNumber)).toEqual([2, 1])
    expect(grouped[0].jobs.map((j) => j.title)).toEqual(['Brakes', 'Oil'])
    expect(grouped[0].jobs[0].approvalState).toBe('declined')
    expect(grouped[1].jobs).toHaveLength(1)
  })

  it('yields a ticket with no jobs when the job columns are null', () => {
    const grouped = groupVehicleHistoryRows([row({ ticketId: 't9', ticketNumber: 9 })])

    expect(grouped).toHaveLength(1)
    expect(grouped[0].jobs).toEqual([])
  })
})
