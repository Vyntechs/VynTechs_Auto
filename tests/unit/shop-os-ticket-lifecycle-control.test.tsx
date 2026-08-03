import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TicketLifecycleControl } from '@/components/screens/ticket-lifecycle-control'

const TICKET_ID = '00000000-0000-4000-8000-000000000020'
const REQUEST = '00000000-0000-4000-8000-000000000090'

describe('TicketLifecycleControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('crypto', { randomUUID: () => REQUEST })
  })

  it('cancels a repair order in place with a reason and the server-confirmed job truth', async () => {
    const onApplied = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      changed: true,
      ticket: { id: TICKET_ID, status: 'canceled', jobs: [{ id: 'job-1', workStatus: 'canceled' }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<TicketLifecycleControl ticketId={TICKET_ID} status="open" onApplied={onApplied} />)

    fireEvent.click(screen.getAllByText('Cancel repair order')[0])
    fireEvent.change(screen.getByLabelText('Cancellation reason'), {
      target: { value: 'Customer rescheduled this repair.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel repair order' }))

    await waitFor(() => expect(onApplied).toHaveBeenCalledWith({
      id: TICKET_ID, status: 'canceled', jobs: [{ id: 'job-1', workStatus: 'canceled' }],
    }))
    expect(fetchMock).toHaveBeenCalledWith(`/api/tickets/${TICKET_ID}/lifecycle`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'cancel', requestKey: REQUEST, reason: 'Customer rescheduled this repair.',
      }),
    }))
  })

  it('reopens a canceled repair order in place from the returned recovery truth', async () => {
    const onApplied = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      changed: true,
      ticket: { id: TICKET_ID, status: 'open', jobs: [{ id: 'job-1', workStatus: 'blocked' }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    render(<TicketLifecycleControl ticketId={TICKET_ID} status="canceled" onApplied={onApplied} />)

    fireEvent.click(screen.getByRole('button', { name: 'Reopen repair order' }))

    await waitFor(() => expect(onApplied).toHaveBeenCalledWith({
      id: TICKET_ID, status: 'open', jobs: [{ id: 'job-1', workStatus: 'blocked' }],
    }))
  })

  it('blocks mutation without unmounting or losing a typed cancellation reason', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { rerender } = render(
      <TicketLifecycleControl
        ticketId={TICKET_ID}
        status="open"
        blocked={false}
        onApplied={vi.fn()}
      />,
    )

    fireEvent.click(screen.getAllByText('Cancel repair order')[0])
    const reason = screen.getByLabelText('Cancellation reason')
    fireEvent.change(reason, { target: { value: 'Customer needs another week.' } })

    rerender(<TicketLifecycleControl
      ticketId={TICKET_ID}
      status="open"
      blocked
      onApplied={vi.fn()}
    />)

    expect(reason).toHaveValue('Customer needs another week.')
    expect(screen.getByRole('button', { name: 'Cancel repair order' })).toBeDisabled()
    fireEvent.submit(screen.getByRole('button', { name: 'Cancel repair order' }).closest('form')!)
    expect(fetchMock).not.toHaveBeenCalled()

    rerender(<TicketLifecycleControl
      ticketId={TICKET_ID}
      status="open"
      blocked={false}
      onApplied={vi.fn()}
    />)
    expect(screen.getByLabelText('Cancellation reason')).toHaveValue('Customer needs another week.')
    expect(screen.getByRole('button', { name: 'Cancel repair order' })).toBeEnabled()
  })

  it('reports its mutation lifetime to the parent arbitration owner', async () => {
    let resolveRequest!: (response: Response) => void
    const request = new Promise<Response>((resolve) => { resolveRequest = resolve })
    const onMutationStateChange = vi.fn()
    vi.stubGlobal('fetch', vi.fn(() => request))
    render(<TicketLifecycleControl
      ticketId={TICKET_ID}
      status="open"
      onMutationStateChange={onMutationStateChange}
      onApplied={vi.fn()}
    />)

    fireEvent.click(screen.getAllByText('Cancel repair order')[0])
    fireEvent.change(screen.getByLabelText('Cancellation reason'), {
      target: { value: 'Customer needs another week.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel repair order' }))
    expect(onMutationStateChange).toHaveBeenLastCalledWith(true)

    resolveRequest(new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }))
    await waitFor(() => expect(onMutationStateChange).toHaveBeenLastCalledWith(false))
  })
})
