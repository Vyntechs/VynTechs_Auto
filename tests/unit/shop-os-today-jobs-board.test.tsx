import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TodayJobsBoard as TodayJobsBoardComponent } from '@/components/screens/today-jobs-board'
import type { TodayTicketJob } from '@/lib/tickets'
import type { ComponentProps } from 'react'

function TodayJobsBoard(props: ComponentProps<typeof TodayJobsBoardComponent>) {
  return <TodayJobsBoardComponent diagnosticsEntitled {...props} />
}

const { pushMock, refreshMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}))

const ATTEMPT_ONE = '00000000-0000-4000-8000-000000000081'
const ATTEMPT_TWO = '00000000-0000-4000-8000-000000000082'
const RETURNED_SESSION = '00000000-0000-4000-8000-000000000083'

const linkedDiagnostic: TodayTicketJob = {
  id: 'job-linked',
  ticketId: 'ticket-41',
  ticketNumber: 41,
  concern: 'Intermittent no-start after overnight parking',
  customerName: 'Morgan Lee',
  vehicle: { year: 2018, make: 'Honda', model: 'Accord' },
  title: 'Trace intermittent no-start',
  kind: 'diagnostic',
  requiredSkillTier: 2,
  sessionId: 'session-41',
  workStatus: 'in_progress',
  approvalState: 'pending_quote',
  canClaim: false,
  assignmentState: 'mine',
  assignedTechName: 'Taylor Tech',
  createdByMe: false,
  diagnosticStartState: 'ready',
  diagnosticStartErrorCode: null,
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
  canClaim: true,
  assignmentState: 'mine',
  assignedTechName: 'Taylor Tech',
  diagnosticStartState: 'idle',
  diagnosticStartErrorCode: null,
}

const availableDiagnostic: TodayTicketJob = {
  ...unlinkedDiagnostic,
  assignmentState: 'unassigned',
  assignedTechName: null,
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
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn()
        .mockReturnValueOnce(ATTEMPT_ONE)
        .mockReturnValueOnce(ATTEMPT_TWO),
    })
  })

  afterEach(() => {
    cleanup()
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

  it('honestly signals when the bounded Today view has more work', () => {
    render(<TodayJobsBoard myJobs={[linkedDiagnostic]} openJobs={[]} hasMore />)

    expect(screen.getByText('Showing the first 200 active jobs. Assigned work appears first; remaining work stays stored.')).toBeInTheDocument()
  })

  it('renders created work as a quiet recovery lane without ownership actions', () => {
    render(
      <TodayJobsBoard
        myJobs={[]}
        openJobs={[]}
        createdJobs={[{
          ...maintenance,
          canClaim: false,
          assignmentState: 'team',
          assignedTechName: 'Avery Tech',
          createdByMe: true,
        }]}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Created by me' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View ticket' })).toHaveAttribute(
      'href',
      '/tickets/ticket-44',
    )
    expect(screen.queryByRole('button', { name: 'Claim job' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Open work' })).toBeNull()
  })

  it('opens a pending quote in the mounted board instead of navigating away', async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <TodayJobsBoard
        myJobs={[{
          ...maintenance,
          concern: 'Customer hears a brake squeal when stopping.',
          approvalState: 'pending_quote',
          workStatus: 'open',
        }]}
        openJobs={[]}
        canBuildQuote
        currentProfileId="profile-1"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Build quote' }))

    expect(screen.getByRole('region', { name: 'Inline quote workspace' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Opening the current quote…')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/tickets/ticket-44/quote',
      { cache: 'no-store' },
    ))
    expect(screen.queryByRole('link', { name: 'Open the full quote page' })).toBeNull()
  })

  it('does not expose the quote workspace without the server-resolved role capability', () => {
    render(
      <TodayJobsBoard
        myJobs={[{
          ...maintenance,
          concern: 'Customer hears a brake squeal when stopping.',
          approvalState: 'pending_quote',
          workStatus: 'open',
        }]}
        openJobs={[]}
        currentProfileId="profile-1"
      />,
    )

    expect(screen.queryByRole('button', { name: 'Build quote' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Inline quote workspace' })).toBeNull()
  })

  it('opens assigned simple work directly beneath its command instead of navigating away', async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <TodayJobsBoard
        myJobs={[maintenance]}
        openJobs={[]}
        currentProfileId="profile-1"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open work' }))

    expect(screen.getByLabelText('Work workspace')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Opening assigned work…')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/tickets/ticket-44/jobs/job-maintenance/work',
      { method: 'GET', cache: 'no-store' },
    ))
    expect(screen.queryByRole('link', { name: 'Open the full work page' })).toBeNull()
  })

  it('fails closed when an open-queue row is not actually open', () => {
    render(
      <TodayJobsBoard
        myJobs={[]}
        openJobs={[{
          ...availableDiagnostic,
          workStatus: 'blocked',
          canClaim: true,
          createdByMe: true,
        }]}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Claim job' })).toBeNull()
    expect(screen.getByRole('link', { name: 'View ticket' })).toHaveAttribute(
      'href',
      '/tickets/ticket-42',
    )
  })

  it('uses honest persisted-data fallbacks without inventing customer or vehicle facts', () => {
    render(<TodayJobsBoard myJobs={[unlinkedDiagnostic]} openJobs={[]} />)

    const row = screen.getByRole('article', { name: 'Ticket 42: Confirm charging fault' })
    expect(within(row).getByText('Customer not recorded')).toBeInTheDocument()
    expect(within(row).getByText('Vehicle not recorded')).toBeInTheDocument()
  })

  it('opens a ready owned diagnostic and starts an idle unlinked diagnostic', () => {
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
    expect(within(unlinkedRow).getByRole('button', { name: 'Start diagnosis' })).toBeEnabled()
  })

  it('opens a safely accessible legacy session even when bootstrap state is still idle', () => {
    render(
      <TodayJobsBoard
        myJobs={[{ ...linkedDiagnostic, diagnosticStartState: 'idle' }]}
        openJobs={[]}
      />,
    )

    expect(screen.getByRole('link', { name: 'Open diagnosis' })).toHaveAttribute(
      'href',
      '/sessions/session-41',
    )
    expect(screen.queryByRole('button', { name: 'Start diagnosis' })).toBeNull()
  })

  it('opens identity-complete simple work without claiming authorization truth', () => {
    render(<TodayJobsBoard myJobs={[maintenance]} openJobs={[]} />)
    expect(screen.getByRole('link', { name: 'Open work' })).toHaveAttribute(
      'href', '/tickets/ticket-44/jobs/job-maintenance/work',
    )
    expect(screen.queryByText(/approved|approval required/i)).toBeNull()
  })

  it('routes blocked or identity-incomplete simple work to honest ticket context', () => {
    render(<TodayJobsBoard myJobs={[
      repair,
      { ...maintenance, id: 'missing-identity', ticketId: 'ticket-45', customerName: null, vehicle: null },
    ]} openJobs={[]} />)
    expect(screen.getByRole('link', { name: 'Review blocked work' })).toHaveAttribute('href', '/tickets/ticket-43')
    expect(screen.getByRole('link', { name: 'Review work order' })).toHaveAttribute('href', '/tickets/ticket-45')
  })

  it('does not create a dead work link for corrupt session-linked simple work', () => {
    render(<TodayJobsBoard myJobs={[{ ...maintenance, sessionId: 'unexpected-session' }]} openJobs={[]} />)
    expect(screen.getByRole('link', { name: 'Review work order' })).toHaveAttribute('href', '/tickets/ticket-44')
    expect(screen.queryByRole('link', { name: 'Open work' })).toBeNull()
  })

  it.each(['idle', 'failed'] as const)(
    'posts one fresh attempt for a %s diagnostic and navigates only to the returned session',
    async (diagnosticStartState) => {
      let resolveResponse: ((response: Response) => void) | undefined
      const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
        resolveResponse = resolve
      }))
      vi.stubGlobal('fetch', fetchMock)
      render(
        <TodayJobsBoard
          myJobs={[{ ...unlinkedDiagnostic, diagnosticStartState }]}
          openJobs={[]}
        />,
      )

      const start = screen.getByRole('button', { name: 'Start diagnosis' })
      fireEvent.click(start)

      expect(await screen.findByRole('status')).toHaveTextContent(
        'Starting diagnosis for ticket 42',
      )
      expect(screen.getByRole('button', { name: 'Starting diagnosis…' })).toBeDisabled()
      fireEvent.click(screen.getByRole('button', { name: 'Starting diagnosis…' }))
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/tickets/ticket-42/jobs/job-unlinked/diagnostic/start',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ attemptKey: ATTEMPT_ONE }),
        },
      )
      resolveResponse?.({
        ok: true,
        status: 200,
        json: async () => ({ state: 'ready', sessionId: RETURNED_SESSION }),
      } as Response)
      await waitFor(() => {
        expect(pushMock).toHaveBeenCalledWith(`/sessions/${RETURNED_SESSION}`)
      })
      expect(refreshMock).not.toHaveBeenCalled()
    },
  )

  it('waits on an initializing diagnostic and refreshes server truth without posting again', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ state: 'initializing', retryAfterSeconds: 5 }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<TodayJobsBoard myJobs={[unlinkedDiagnostic]} openJobs={[]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Start diagnosis' }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Diagnosis is already starting. Refreshing status.',
      )
      expect(refreshMock).toHaveBeenCalledTimes(1)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('checks persisted initializing state once with an exact status-only payload', async () => {
    let resolveResponse: ((response: Response) => void) | undefined
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveResponse = resolve
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <TodayJobsBoard
        myJobs={[{ ...unlinkedDiagnostic, diagnosticStartState: 'initializing' }]}
        openJobs={[]}
      />,
    )

    expect(screen.getByRole('button', { name: 'Diagnosis starting…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh diagnosis status' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Checking diagnosis status for ticket 42',
    )
    expect(screen.getByRole('button', { name: 'Checking status…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Checking status…' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tickets/ticket-42/jobs/job-unlinked/diagnostic/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attemptKey: ATTEMPT_ONE, statusOnly: true }),
      },
    )
    resolveResponse?.({
      ok: true,
      status: 202,
      json: async () => ({ state: 'initializing', retryAfterSeconds: 5 }),
    } as Response)
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Diagnosis is still starting. Refreshing status.',
      )
      expect(refreshMock).toHaveBeenCalledTimes(1)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('turns a status-only ambiguity response into explicit confirmation without auto-retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ state: 'ambiguous', warning: 'possible_duplicate_cost' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <TodayJobsBoard
        myJobs={[{ ...unlinkedDiagnostic, diagnosticStartState: 'initializing' }]}
        openJobs={[]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Refresh diagnosis status' }))

    expect(await screen.findByText(/already have used a paid provider call/i)).toBeVisible()
    expect(screen.getByRole('button', {
      name: 'Start again despite possible duplicate cost',
    })).toBeEnabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({
      attemptKey: ATTEMPT_ONE,
      statusOnly: true,
    }))
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('opens only a valid owned session returned by a status-only check', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ state: 'ready', sessionId: RETURNED_SESSION }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <TodayJobsBoard
        myJobs={[{ ...unlinkedDiagnostic, diagnosticStartState: 'initializing' }]}
        openJobs={[]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Refresh diagnosis status' }))

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(
      `/sessions/${RETURNED_SESSION}`,
    ))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({
      attemptKey: ATTEMPT_ONE,
      statusOnly: true,
    }))
  })

  it('refreshes a failed status check without auto-starting another attempt', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ state: 'failed', error: 'start_failed' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <TodayJobsBoard
        myJobs={[{ ...unlinkedDiagnostic, diagnosticStartState: 'initializing' }]}
        openJobs={[]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Refresh diagnosis status' }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Diagnosis did not start. Refreshing status.',
      )
      expect(refreshMock).toHaveBeenCalledTimes(1)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('requires explicit possible-duplicate-cost confirmation with a fresh attempt key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ state: 'ready', sessionId: RETURNED_SESSION }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <TodayJobsBoard
        myJobs={[{ ...unlinkedDiagnostic, diagnosticStartState: 'ambiguous' }]}
        openJobs={[]}
      />,
    )

    expect(screen.getByText(
      'This diagnostic may already have used a paid provider call. Starting again could create a duplicate cost.',
    )).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Start again despite possible duplicate cost' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/tickets/ticket-42/jobs/job-unlinked/diagnostic/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          attemptKey: ATTEMPT_ONE,
          confirmAmbiguousRetry: true,
        }),
      },
    ))
  })

  it('turns a 409 ambiguity response into the explicit confirmation without auto-retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ state: 'ambiguous', warning: 'possible_duplicate_cost' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<TodayJobsBoard myJobs={[unlinkedDiagnostic]} openJobs={[]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Start diagnosis' }))

    expect(await screen.findByText(/already have used a paid provider call/i)).toBeVisible()
    expect(screen.getByRole('button', {
      name: 'Start again despite possible duplicate cost',
    })).toBeEnabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('lets every newer server state replace local ambiguity', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ state: 'ambiguous', warning: 'possible_duplicate_cost' }),
    }))
    const { rerender } = render(
      <TodayJobsBoard myJobs={[unlinkedDiagnostic]} openJobs={[]} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Start diagnosis' }))
    expect(await screen.findByText(/already have used a paid provider call/i)).toBeVisible()

    rerender(
      <TodayJobsBoard
        myJobs={[{ ...unlinkedDiagnostic, diagnosticStartState: 'initializing' }]}
        openJobs={[]}
      />,
    )
    expect(screen.getByRole('button', { name: 'Diagnosis starting…' })).toBeDisabled()
    expect(screen.queryByText(/duplicate cost/i)).toBeNull()

    rerender(
      <TodayJobsBoard
        myJobs={[{ ...unlinkedDiagnostic, diagnosticStartState: 'failed' }]}
        openJobs={[]}
      />,
    )
    expect(screen.getByRole('button', { name: 'Start diagnosis' })).toBeEnabled()
    expect(screen.queryByText(/duplicate cost/i)).toBeNull()

    rerender(
      <TodayJobsBoard
        myJobs={[{
          ...unlinkedDiagnostic,
          diagnosticStartState: 'ready',
          sessionId: 'session-42',
        }]}
        openJobs={[]}
      />,
    )
    expect(screen.getByRole('link', { name: 'Open diagnosis' })).toHaveAttribute(
      'href',
      '/sessions/session-42',
    )
    expect(screen.queryByText(/duplicate cost/i)).toBeNull()
  })

  it('uses a fresh second attempt only after explicit ambiguous retry confirmation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ state: 'ambiguous', warning: 'possible_duplicate_cost' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'ready', sessionId: RETURNED_SESSION }),
      })
    vi.stubGlobal('fetch', fetchMock)
    render(<TodayJobsBoard myJobs={[unlinkedDiagnostic]} openJobs={[]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Start diagnosis' }))
    const confirm = await screen.findByRole('button', {
      name: 'Start again despite possible duplicate cost',
    })
    expect(fetchMock).toHaveBeenNthCalledWith(1,
      '/api/tickets/ticket-42/jobs/job-unlinked/diagnostic/start',
      expect.objectContaining({
        body: JSON.stringify({ attemptKey: ATTEMPT_ONE }),
      }),
    )

    fireEvent.click(confirm)

    await waitFor(() => expect(fetchMock).toHaveBeenNthCalledWith(2,
      '/api/tickets/ticket-42/jobs/job-unlinked/diagnostic/start',
      expect.objectContaining({
        body: JSON.stringify({
          attemptKey: ATTEMPT_TWO,
          confirmAmbiguousRetry: true,
        }),
      }),
    ))
    expect(pushMock).toHaveBeenCalledWith(`/sessions/${RETURNED_SESSION}`)
  })

  it('keeps an inconsistent ready diagnostic unavailable and offers only a server refresh', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(
      <TodayJobsBoard
        myJobs={[{ ...unlinkedDiagnostic, diagnosticStartState: 'ready' }]}
        openJobs={[]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Refresh diagnosis status' }))

    expect(refreshMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('announces a generic start error without exposing route or persisted error details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'open_session_limit', privateDetail: 'provider-secret' }),
    }))
    render(
      <TodayJobsBoard
        myJobs={[{ ...unlinkedDiagnostic, diagnosticStartErrorCode: 'rate_limited' }]}
        openJobs={[]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Start diagnosis' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't start diagnosis for ticket 42. Try again.")
    expect(alert).not.toHaveTextContent(/open_session_limit|provider-secret|rate_limited/)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('refuses to navigate to a malformed ready-session identifier', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ state: 'ready', sessionId: '../../private-route' }),
    }))
    render(<TodayJobsBoard myJobs={[unlinkedDiagnostic]} openJobs={[]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Start diagnosis' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't start diagnosis for ticket 42. Try again.",
    )
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('renders one explicit claim control for an open row and posts to the exact assignment route', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        assignment: {
          ticketId: unlinkedDiagnostic.ticketId,
          jobId: unlinkedDiagnostic.id,
          workStatus: 'open',
          state: 'mine',
          assignedTechName: 'Taylor Tech',
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<TodayJobsBoard myJobs={[]} openJobs={[availableDiagnostic]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Claim job' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/tickets/ticket-42/jobs/job-unlinked/assignment',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'claim', requestKey: ATTEMPT_ONE }),
      },
    ))
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('announces pending and success, disables duplicate claims, and moves the row in place', async () => {
    let resolveResponse: ((response: Response) => void) | undefined
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveResponse = resolve
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(<TodayJobsBoard myJobs={[]} openJobs={[availableDiagnostic]} />)

    const claim = screen.getByRole('button', { name: 'Claim job' })
    fireEvent.click(claim)

    expect(await screen.findByRole('status')).toHaveTextContent('Claiming ticket 42')
    expect(screen.getByRole('button', { name: 'Claiming…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Claiming…' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveResponse?.({
      ok: true,
      status: 200,
      json: async () => ({
        assignment: {
          ticketId: unlinkedDiagnostic.ticketId,
          jobId: unlinkedDiagnostic.id,
          workStatus: 'open',
          state: 'mine',
          assignedTechName: 'Taylor Tech',
        },
      }),
    } as Response)

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Ticket 42 claimed')
      expect(screen.getByRole('heading', { name: 'My work' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Available' })).toBeNull()
      expect(refreshMock).not.toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(screen.getByRole('article', {
        name: 'Ticket 42: Confirm charging fault',
      })).toHaveFocus()
    })
  })

  it('disables every claim control while one assignment is pending', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    const secondOpenJob = {
      ...availableDiagnostic,
      id: 'job-second',
      ticketId: 'ticket-45',
      ticketNumber: 45,
      title: 'Inspect coolant leak',
    }
    render(
      <TodayJobsBoard
        myJobs={[]}
        openJobs={[availableDiagnostic, secondOpenJob]}
      />,
    )

    const claims = screen.getAllByRole('button', { name: 'Claim job' })
    fireEvent.click(claims[0])

    await screen.findByRole('status')
    expect(claims[0]).toBeDisabled()
    expect(claims[1]).toBeDisabled()
  })

  it('announces only the safe winner and moves a dispatch race to With the team', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'assignment_conflict',
        currentAssignee: { fullName: 'Winner Tech' },
      }),
    }))
    render(
      <TodayJobsBoard
        myJobs={[]}
        openJobs={[availableDiagnostic]}
        canDispatchWork
        currentProfileId="00000000-0000-4000-8000-000000000095"
        team={[{
          id: '00000000-0000-4000-8000-000000000096',
          name: 'Avery Tech',
          skillTier: 3,
          isCurrentUser: false,
        }]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Assign work' }))
    fireEvent.click(screen.getByRole('button', { name: /Avery Tech/ }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Already assigned to Winner Tech')
      expect(screen.getByRole('heading', { name: 'With the team' })).toBeInTheDocument()
      expect(screen.getByText('Winner Tech')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Assign work' })).toBeNull()
      expect(refreshMock).not.toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(screen.getByRole('article', {
        name: 'Ticket 42: Confirm charging fault',
      })).toHaveFocus()
    })
    expect(screen.queryByText(/hidden-id|owner/i)).toBeNull()
  })

  it('uses a generic race announcement and quietly removes unrelated team work', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'assignment_conflict' }),
    }))
    render(<TodayJobsBoard myJobs={[]} openJobs={[availableDiagnostic]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Claim job' }))

    expect(await screen.findByRole('status')).toHaveTextContent('This job was already claimed')
    expect(screen.queryByRole('article')).toBeNull()
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it('keeps a creator losing race discoverable without exposing ownership actions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'assignment_conflict',
        currentAssignee: { fullName: 'Winner Tech' },
      }),
    }))
    render(
      <TodayJobsBoard
        myJobs={[]}
        openJobs={[{ ...availableDiagnostic, createdByMe: true }]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Claim job' }))

    expect(await screen.findByRole('heading', { name: 'Created by me' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View ticket' })).toHaveAttribute(
      'href',
      '/tickets/ticket-42',
    )
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it('fails closed on a mismatched success without dropping the row or enabling stale retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        assignment: {
          ticketId: 'wrong-ticket',
          jobId: unlinkedDiagnostic.id,
          workStatus: 'open',
          state: 'mine',
          assignedTechName: 'Taylor Tech',
        },
      }),
    }))
    render(<TodayJobsBoard myJobs={[]} openJobs={[availableDiagnostic]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Claim job' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Ticket 42 changed, but this screen couldn't safely reconcile it. View the ticket.",
    )
    expect(screen.getByRole('article', { name: 'Ticket 42: Confirm charging fault' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Claim job' })).toBeNull()
    expect(screen.getByRole('link', { name: 'View ticket' })).toBeInTheDocument()
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it('announces an error, restores the focused control, and does not refresh stale truth', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network detail must stay private')))
    render(<TodayJobsBoard myJobs={[]} openJobs={[availableDiagnostic]} />)

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

  it('keeps long assignee names inside the ledger and gives moved rows visible focus', () => {
    const css = readFileSync(
      join(process.cwd(), 'components/screens/today-jobs-board.module.css'),
      'utf8',
    )

    expect(css).toMatch(/\.facts span\s*{[^}]*overflow-wrap:\s*anywhere/s)
    expect(css).toMatch(/\.row:focus-visible,[^{]*{[^}]*outline:\s*2px solid var\(--vt-focus-ring\)/s)
  })
})

describe('TodayJobsBoard parts handoff', () => {
  it('lets the parts desk finish its next request without leaving Today', async () => {
    const requestId = '00000000-0000-4000-8000-000000000091'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        request: {
          id: requestId,
          jobId: '00000000-0000-4000-8000-000000000092',
          description: 'Front brake pads',
          preference: null,
          quantity: 1,
          status: 'sourced',
          requestedAt: '2026-07-21T12:00:00.000Z',
          resolvedAt: '2026-07-21T12:01:00.000Z',
        },
      }),
    }))
    render(
      <TodayJobsBoard
        myJobs={[]}
        openJobs={[]}
        partsJobs={[{
          ...unlinkedDiagnostic,
          partRequest: {
            id: requestId,
            description: 'Front brake pads',
            preference: null,
            quantity: 1,
          },
        }]}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Parts needed' })).toBeInTheDocument()
    expect(screen.getByText('Needs 1× Front brake pads')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull())
    expect(fetch).toHaveBeenCalledWith(
      '/api/tickets/ticket-42/part-requests/00000000-0000-4000-8000-000000000091',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('lets a dispatcher assign directly from the open queue', async () => {
    const currentProfileId = '00000000-0000-4000-8000-000000000093'
    const assigneeId = '00000000-0000-4000-8000-000000000094'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        assignment: {
          ticketId: 'ticket-42',
          jobId: 'job-unlinked',
          workStatus: 'open',
          state: 'team',
          assignedTechName: 'Avery Tech',
        },
      }),
    }))
    render(
      <TodayJobsBoard
        myJobs={[]}
        openJobs={[availableDiagnostic]}
        canDispatchWork
        currentProfileId={currentProfileId}
        team={[{ id: assigneeId, name: 'Avery Tech', skillTier: 3, isCurrentUser: false }]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Assign work' }))
    fireEvent.click(screen.getByRole('button', { name: /Avery Tech/ }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'With the team' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Hand off' })).toBeInTheDocument()
    expect(refreshMock).not.toHaveBeenCalled()
  })
})

describe('TodayJobsBoard diagnostics entitlement one-slot rule', () => {
  it('renders the legacy Start diagnosis action only when explicitly enabled', () => {
    render(<TodayJobsBoard myJobs={[unlinkedDiagnostic]} openJobs={[]} />)

    expect(screen.getByRole('button', { name: 'Start diagnosis' })).toBeInTheDocument()
    expect(screen.queryByText('Record findings')).not.toBeInTheDocument()
    expect(screen.queryByText('Diagnose with AI — add-on')).not.toBeInTheDocument()
  })

  it('defaults to Record findings with no engine control or add-on teaser', () => {
    render(
      <TodayJobsBoardComponent
        myJobs={[unlinkedDiagnostic]}
        openJobs={[]}
      />,
    )

    const link = screen.getByRole('link', { name: 'Record findings' })
    expect(link).toHaveAttribute('href', '/tickets/ticket-42/quote')
    expect(screen.queryByRole('button', { name: 'Start diagnosis' })).not.toBeInTheDocument()
    expect(screen.queryByText('Diagnose with AI — add-on')).not.toBeInTheDocument()
  })

  it('opens approved sessionless manual diagnostic work without reopening the engine', () => {
    render(
      <TodayJobsBoardComponent
        myJobs={[{
          ...unlinkedDiagnostic,
          customerName: 'Golden Customer',
          vehicle: { year: 2020, make: 'Ford', model: 'F-150' },
          approvalState: 'approved',
        }]}
        openJobs={[]}
      />,
    )

    expect(screen.getByRole('link', { name: 'Open work' })).toHaveAttribute(
      'href',
      '/tickets/ticket-42/jobs/job-unlinked/work',
    )
    expect(screen.queryByRole('button', { name: 'Start diagnosis' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Record findings' })).toBeNull()
  })

  it('fails closed for linked diagnostics too: no Open diagnosis without the add-on', () => {
    render(
      <TodayJobsBoardComponent
        myJobs={[linkedDiagnostic]}
        openJobs={[]}
      />,
    )

    expect(screen.getByRole('link', { name: 'Record findings' })).toHaveAttribute(
      'href',
      '/tickets/ticket-41/quote',
    )
    expect(screen.queryByRole('link', { name: 'Open diagnosis' })).not.toBeInTheDocument()
  })

  it('leaves repair and maintenance actions untouched without the add-on', () => {
    render(
      <TodayJobsBoardComponent
        myJobs={[repair, maintenance]}
        openJobs={[]}
      />,
    )

    expect(screen.queryByText('Record findings')).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Open work|Review blocked work|Review work order/ })).toHaveLength(2)
  })
})
