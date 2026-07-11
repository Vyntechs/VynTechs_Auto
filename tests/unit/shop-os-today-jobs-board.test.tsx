import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TodayJobsBoard } from '@/components/screens/today-jobs-board'
import type { TodayTicketJob } from '@/lib/tickets'

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}))

const linkedDiagnostic: TodayTicketJob = {
  id: 'job-linked',
  ticketId: 'ticket-41',
  ticketNumber: 41,
  customerName: 'Morgan Lee',
  vehicle: { year: 2018, make: 'Honda', model: 'Accord' },
  title: 'Trace intermittent no-start',
  kind: 'diagnostic',
  requiredSkillTier: 2,
  sessionId: 'session-41',
  workStatus: 'in_progress',
}

const unlinkedDiagnostic: TodayTicketJob = {
  ...linkedDiagnostic,
  id: 'job-unlinked',
  ticketId: 'ticket-42',
  ticketNumber: 42,
  customerName: null,
  vehicle: null,
  title: 'Confirm charging fault',
  sessionId: null,
  workStatus: 'open',
}

const repair: TodayTicketJob = {
  ...linkedDiagnostic,
  id: 'job-repair',
  ticketId: 'ticket-43',
  ticketNumber: 43,
  title: 'Replace front brake pads',
  kind: 'repair',
  requiredSkillTier: 1,
  sessionId: null,
  workStatus: 'blocked',
}

const maintenance: TodayTicketJob = {
  ...repair,
  id: 'job-maintenance',
  ticketId: 'ticket-44',
  ticketNumber: 44,
  title: 'Perform 60k service',
  kind: 'maintenance',
  requiredSkillTier: 3,
  workStatus: 'open',
}

describe('TodayJobsBoard persisted ledger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the persisted repair-order facts and canonical ticket link', () => {
    render(<TodayJobsBoard myJobs={[linkedDiagnostic]} openJobs={[]} />)

    const row = screen.getByRole('article', { name: 'Ticket 41: Trace intermittent no-start' })
    expect(within(row).getByText('#0041')).toBeInTheDocument()
    expect(within(row).getByText('Morgan Lee')).toBeInTheDocument()
    expect(within(row).getByText('2018 Honda Accord')).toBeInTheDocument()
    expect(within(row).getByText('Trace intermittent no-start')).toBeInTheDocument()
    expect(within(row).getByText('Diagnostic')).toBeInTheDocument()
    expect(within(row).getByText('Tier 2')).toBeInTheDocument()
    expect(within(row).getByText('In progress')).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: 'Open ticket 41' })).toHaveAttribute(
      'href',
      '/tickets/ticket-41',
    )
  })

  it('uses honest persisted-data fallbacks without inventing customer or vehicle facts', () => {
    render(<TodayJobsBoard myJobs={[unlinkedDiagnostic]} openJobs={[]} />)

    const row = screen.getByRole('article', { name: 'Ticket 42: Confirm charging fault' })
    expect(within(row).getByText('Customer not recorded')).toBeInTheDocument()
    expect(within(row).getByText('Vehicle not recorded')).toBeInTheDocument()
  })

  it('opens only an already-linked diagnostic and never invents an unlinked start', () => {
    render(
      <TodayJobsBoard
        myJobs={[linkedDiagnostic, unlinkedDiagnostic]}
        openJobs={[]}
      />,
    )

    const linkedRow = screen.getByRole('article', {
      name: 'Ticket 41: Trace intermittent no-start',
    })
    expect(within(linkedRow).getByRole('link', { name: 'Open diagnosis' })).toHaveAttribute(
      'href',
      '/sessions/session-41',
    )

    const unlinkedRow = screen.getByRole('article', {
      name: 'Ticket 42: Confirm charging fault',
    })
    expect(within(unlinkedRow).queryByRole('link', { name: /diagnosis/i })).toBeNull()
    expect(within(unlinkedRow).queryByRole('button', { name: /diagnosis/i })).toBeNull()
  })

  it.each([repair, maintenance])(
    'keeps assigned $kind work disabled behind exact quote approval copy',
    (job) => {
      render(<TodayJobsBoard myJobs={[job]} openJobs={[]} />)

      const control = screen.getByRole('button', { name: 'Quote and approval required' })
      expect(control).toBeDisabled()
      expect(control).toHaveStyle({ minHeight: '44px' })
    },
  )

  it('renders one explicit claim control for an open row and posts to the exact assignment route', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ticket: { id: unlinkedDiagnostic.ticketId } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<TodayJobsBoard myJobs={[]} openJobs={[unlinkedDiagnostic]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Claim job' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/tickets/ticket-42/jobs/job-unlinked/assignment',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'claim' }),
      },
    ))
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('announces pending and success, disables duplicate claims, and refreshes server truth', async () => {
    let resolveResponse: ((response: Response) => void) | undefined
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveResponse = resolve
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(<TodayJobsBoard myJobs={[]} openJobs={[unlinkedDiagnostic]} />)

    const claim = screen.getByRole('button', { name: 'Claim job' })
    fireEvent.click(claim)

    expect(await screen.findByRole('status')).toHaveTextContent('Claiming ticket 42')
    expect(screen.getByRole('button', { name: 'Claiming…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Claiming…' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveResponse?.({
      ok: true,
      status: 200,
      json: async () => ({ ticket: { id: unlinkedDiagnostic.ticketId } }),
    } as Response)

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Ticket 42 claimed')
      expect(refreshMock).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Ticket jobs' })).toHaveFocus()
    })
  })

  it('disables every claim control while one assignment is pending', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    const secondOpenJob = {
      ...unlinkedDiagnostic,
      id: 'job-second',
      ticketId: 'ticket-45',
      ticketNumber: 45,
      title: 'Inspect coolant leak',
    }
    render(
      <TodayJobsBoard
        myJobs={[]}
        openJobs={[unlinkedDiagnostic, secondOpenJob]}
      />,
    )

    const claims = screen.getAllByRole('button', { name: 'Claim job' })
    fireEvent.click(claims[0])

    await screen.findByRole('status')
    expect(claims[0]).toBeDisabled()
    expect(claims[1]).toBeDisabled()
  })

  it('announces only the safe winner after a losing race and refreshes server truth', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'assignment_conflict',
        currentAssignee: {
          id: 'hidden-id',
          fullName: 'Winner Tech',
          role: 'owner',
          skillTier: 3,
        },
      }),
    }))
    render(<TodayJobsBoard myJobs={[]} openJobs={[unlinkedDiagnostic]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Claim job' }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Already claimed by Winner Tech')
      expect(refreshMock).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Ticket jobs' })).toHaveFocus()
    })
    expect(screen.queryByText(/hidden-id|owner|tier 3/i)).toBeNull()
  })

  it('uses a generic race announcement when no safe winner is returned', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'assignment_conflict' }),
    }))
    render(<TodayJobsBoard myJobs={[]} openJobs={[unlinkedDiagnostic]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Claim job' }))

    expect(await screen.findByRole('status')).toHaveTextContent('This job was already claimed')
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('announces an error, restores the focused control, and does not refresh stale truth', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network detail must stay private')))
    render(<TodayJobsBoard myJobs={[]} openJobs={[unlinkedDiagnostic]} />)

    const claim = screen.getByRole('button', { name: 'Claim job' })
    claim.focus()
    fireEvent.click(claim)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't claim ticket 42. Try again.")
    expect(alert).not.toHaveTextContent('network detail')
    expect(claim).toHaveFocus()
    expect(claim).toBeEnabled()
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it('stacks every repair-order region into one column at 375px', () => {
    const css = readFileSync(
      join(process.cwd(), 'components/screens/today-jobs-board.module.css'),
      'utf8',
    )
    const narrowRules = css.slice(css.indexOf('@media (max-width: 375px)'))

    expect(narrowRules).toMatch(/\.row\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s)
    expect(narrowRules).toMatch(/\.ticketStamp\s*{[^}]*justify-content:\s*flex-start/s)
    expect(narrowRules).toMatch(/\.action\s*{[^}]*grid-column:\s*1/s)
  })

  it('owns a visible token-based focus target without selecting the document main', () => {
    const source = readFileSync(
      join(process.cwd(), 'components/screens/today-jobs-board.tsx'),
      'utf8',
    )
    const css = readFileSync(
      join(process.cwd(), 'components/screens/today-jobs-board.module.css'),
      'utf8',
    )

    expect(source).not.toMatch(/document\.querySelector/)
    expect(css).toMatch(
      /\.board:focus-visible\s*{[^}]*outline:\s*2px solid var\(--vt-focus-ring\)/s,
    )
  })

  it('gives the canonical ticket stamp an explicit 44px target', () => {
    const css = readFileSync(
      join(process.cwd(), 'components/screens/today-jobs-board.module.css'),
      'utf8',
    )
    const baseStampRule = css.slice(
      css.indexOf('.ticketStamp {'),
      css.indexOf('.ticketStamp:hover'),
    )

    expect(baseStampRule).toMatch(/min-height:\s*44px/)
  })
})
