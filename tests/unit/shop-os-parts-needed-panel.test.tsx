import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PartsNeededPanel } from '@/components/screens/parts-needed-panel'
import type { PartRequestView } from '@/lib/shop-os/part-requests-ui'

const TICKET = '00000000-0000-4000-8000-000000000020'
const JOB = '00000000-0000-4000-8000-000000000030'
const REQ = '00000000-0000-4000-8000-000000000040'
const KEY = '00000000-0000-4000-8000-000000000099'

const existing: PartRequestView = {
  id: '00000000-0000-4000-8000-000000000041', jobId: JOB, description: 'Serpentine belt',
  preference: 'AC Delco', quantity: 1, status: 'requested', requestedAt: '2026-07-19T12:00:00.000Z', resolvedAt: null,
}

describe('PartsNeededPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => KEY) })
  })

  it('shows existing flags and never shows money', () => {
    render(<PartsNeededPanel ticketId={TICKET} jobId={JOB} initialRequests={[existing]} />)
    expect(screen.getByText('Serpentine belt')).toBeInTheDocument()
    expect(screen.getByText('AC Delco')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\$/)
  })

  it('flags a part and appends it, sending zero money to the server', async () => {
    const created: PartRequestView = {
      id: REQ, jobId: JOB, description: 'Water pump', preference: 'Motorcraft', quantity: 2,
      status: 'requested', requestedAt: '2026-07-19T12:01:00.000Z', resolvedAt: null,
    }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ request: created }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<PartsNeededPanel ticketId={TICKET} jobId={JOB} initialRequests={[]} />)
    fireEvent.change(screen.getByLabelText('What part do you need?'), { target: { value: ' Water pump ' } })
    fireEvent.change(screen.getByLabelText(/Brand or where/), { target: { value: 'Motorcraft' } })
    fireEvent.change(screen.getByLabelText('How many?'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send to parts' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/tickets/${TICKET}/jobs/${JOB}/part-requests`)
    expect(JSON.parse(String(init?.body))).toEqual({
      requestKey: KEY, description: 'Water pump', preference: 'Motorcraft', quantity: 2,
    })
    expect(await screen.findByText('Water pump')).toBeInTheDocument()
  })

  it('blocks submit until a part is named', () => {
    render(<PartsNeededPanel ticketId={TICKET} jobId={JOB} initialRequests={[]} />)
    expect(screen.getByRole('button', { name: 'Send to parts' })).toBeDisabled()
  })
})
