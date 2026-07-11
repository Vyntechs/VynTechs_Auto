import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ActiveSession } from '@/components/screens/active-session'
import { ClosedCaseSummary } from '@/components/screens/closed-case-summary'
import { DeclinedNoRepairClose } from '@/components/screens/declined-no-repair-close'
import { RepairAskForm } from '@/components/screens/repair-ask-form'
import type { Session } from '@/lib/db/schema'

const session = {
  id: '11111111-1111-4111-8111-111111111111',
  shopId: '22222222-2222-4222-8222-222222222222',
  techId: '33333333-3333-4333-8333-333333333333',
  status: 'open',
  intake: {
    vehicleYear: 2018,
    vehicleMake: 'Ford',
    vehicleModel: 'F-250',
    customerComplaint: 'Low rail pressure under load',
  },
  treeState: {
    nodes: [{ id: 'root', label: 'Confirm pressure', status: 'resolved' }],
    currentNodeId: 'root',
    message: 'Diagnosis locked',
    phase: 'repairing',
    done: true,
    diagnosisLockedAt: '2026-07-11T10:00:00.000Z',
    rootCauseSummary: 'Fuel supply pressure falls below commanded pressure under load.',
    proposedAction: {
      description: 'Test the low-pressure supply circuit.',
      confidence: 0.94,
      expectedSignal: 'Supply pressure remains stable under load.',
    },
  },
  createdAt: new Date('2026-07-11T09:00:00.000Z'),
  closedAt: null,
  outcome: null,
} as unknown as Session

const ticketId = '44444444-4444-4444-8444-444444444444'
const jobId = '55555555-5555-4555-8555-555555555555'
const quoteVersionId = '66666666-6666-4666-8666-666666666666'
const hrefSetter = vi.fn()

describe('ticket-backed repair authorization UI', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        get href() { return 'http://localhost/' },
        set href(value: string) { hrefSetter(value) },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('preserves the legacy repair controls', () => {
    render(<ActiveSession session={session} events={[]} repairAccess={{ state: 'legacy' }} />)
    expect(screen.getByText('Repair conversation')).toBeInTheDocument()
    expect(screen.getByText('Ask the AI')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /repair done & verified/i })).toHaveAttribute(
      'href', `/sessions/${session.id}/outcome`,
    )
  })

  it('keeps repair controls for an approved exact version', () => {
    render(<ActiveSession session={session} events={[]} repairAccess={{
      state: 'approved', ticketId, jobId, quoteVersionId,
    }} />)
    expect(screen.getByText('Approved work')).toBeInTheDocument()
    expect(screen.getByText('Ask the AI')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /repair done & verified/i })).toBeInTheDocument()
  })

  it('hides every repair mutation while approval is pending', () => {
    render(<ActiveSession session={session} events={[]} repairAccess={{
      state: 'awaiting_approval', ticketId, jobId,
    }} />)
    expect(screen.getByText('Quote approval required')).toBeInTheDocument()
    expect(screen.queryByText('Ask the AI')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /repair done & verified/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open quote' })).toHaveAttribute(
      'href', `/tickets/${ticketId}/quote`,
    )
  })

  it('offers only honest no-repair closeout after decline', () => {
    render(<ActiveSession session={session} events={[]} repairAccess={{
      state: 'declined', ticketId, jobId,
    }} />)
    expect(screen.getByText('No repair authorized')).toBeInTheDocument()
    expect(screen.queryByText('Ask the AI')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /repair done & verified/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Close without repair' })).toHaveAttribute(
      'href', `/sessions/${session.id}/outcome`,
    )
  })

  it('fails closed when authorization truth is unavailable', () => {
    render(<ActiveSession session={session} events={[]} repairAccess={{ state: 'unavailable' }} />)
    expect(screen.getByText('Repair authorization unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Ask the AI')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /repair done|close without repair/i })).not.toBeInTheDocument()
  })

  it('confirms declined closeout and sends only the bounded disposition', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' })
    vi.stubGlobal('fetch', fetchMock)
    render(<DeclinedNoRepairClose sessionId={session.id} vehicleName="2018 Ford F-250" />)

    fireEvent.click(screen.getByRole('button', { name: 'Close without repair' }))
    expect(screen.getByText('No repair performed.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Closeout note'), {
      target: { value: 'Customer declined after reviewing the estimate.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm no repair' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      mode: 'declined_no_repair',
      note: 'Customer declined after reviewing the estimate.',
    })
    expect(hrefSetter).toHaveBeenCalledWith('/today')
  })

  it('turns a revoked repair-guidance race into a refresh instruction', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'repair_not_authorized' }),
    }))
    render(<RepairAskForm sessionId={session.id} />)
    fireEvent.change(screen.getByLabelText('Ask a question or report what you found'), {
      target: { value: 'Pressure still drops under load.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Repair approval changed. Refresh the diagnosis before continuing.',
    )
  })

  it('renders declined history without performed-repair claims', () => {
    const closed = {
      ...session,
      status: 'closed',
      closedAt: new Date(),
      outcome: {
        rootCause: session.treeState.rootCauseSummary,
        actionType: 'no_fix',
        verification: { codesCleared: false, testDrive: false, symptomsResolved: 'no' },
        diagMinutes: 60,
        repairMinutes: 0,
        closeout: { kind: 'declined_no_repair' },
      },
    } as unknown as Session
    render(<ClosedCaseSummary session={closed} />)
    expect(screen.getByText('No repair performed')).toBeInTheDocument()
    expect(screen.queryByText('Repair')).not.toBeInTheDocument()
    expect(screen.queryByText(/codes cleared|test drive|resolved:/i)).not.toBeInTheDocument()
  })
})
