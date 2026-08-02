import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TicketInterruptionAction } from '@/components/screens/ticket-interruption-action'

afterEach(() => vi.unstubAllGlobals())

describe('TicketInterruptionAction', () => {
  it('resolves the hold in place and publishes only the server-confirmed job projection', async () => {
    const user = userEvent.setup()
    const onApplied = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      changed: true,
      job: {
        id: 'job-1', assignedTechId: 'tech-1', workStatus: 'in_progress',
        holdKind: null, holdNote: null, holdResumeStatus: null, heldAt: null,
        heldByProfileId: null, clockedOnSince: null, activeSeconds: 90,
        updatedAt: '2026-07-21T15:00:00.000Z',
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    render(<TicketInterruptionAction ticketId="ticket-1" jobId="job-1" onApplied={onApplied} />)
    await user.click(screen.getByRole('button', { name: 'Resolve hold' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/tickets/ticket-1/jobs/job-1/interruption', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: expect.stringContaining('"action":"resolve_hold"'),
    }))
    expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({
      id: 'job-1', workStatus: 'in_progress', holdKind: null,
    }))
    expect(screen.getByRole('status')).toHaveTextContent('Hold resolved.')
  })

  it('retires declined work in place and reports the server-confirmed terminal state', async () => {
    const user = userEvent.setup()
    const onApplied = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      changed: true,
      job: {
        id: 'job-2', assignedTechId: null, workStatus: 'canceled',
        holdKind: null, holdNote: null, holdResumeStatus: null, heldAt: null,
        heldByProfileId: null, clockedOnSince: null, activeSeconds: 0,
        updatedAt: '2026-07-21T15:00:00.000Z',
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <TicketInterruptionAction
        ticketId="ticket-1"
        jobId="job-2"
        action="cancel_job"
        onApplied={onApplied}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Not doing this one' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/tickets/ticket-1/jobs/job-2/interruption', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"action":"cancel_job"'),
    }))
    expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({
      id: 'job-2', workStatus: 'canceled',
    }))
    expect(screen.getByRole('status')).toHaveTextContent('Dropped. The customer said no to this one.')
  })
})
