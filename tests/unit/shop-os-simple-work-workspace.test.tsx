import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SimpleWorkWorkspace } from '@/components/screens/simple-work-workspace'
import type { SimpleWorkWorkspaceView } from '@/lib/shop-os/simple-work-ui'
import { encodeSimpleWorkDraft, simpleWorkDraftStorageKey } from '@/lib/shop-os/simple-work-draft'

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => '/tickets/work',
}))
vi.mock('@/components/vt', () => ({
  AppHeader: ({ title }: { title: string }) => <header>{title}</header>,
}))

const TICKET = '00000000-0000-4000-8000-000000000020'
const JOB = '00000000-0000-4000-8000-000000000030'
const REQUEST = '00000000-0000-4000-8000-000000000080'
const ACTOR = '00000000-0000-4000-8000-000000000001'
const ticket = { id: TICKET, number: 7, customerName: 'Morgan Lee', vehicle: '2020 Jeep Wrangler' }
const base: SimpleWorkWorkspaceView = {
  id: JOB, title: 'Install lift kit', kind: 'repair', workStatus: 'open', workNotes: null,
  startedAt: null, completedAt: null, clockedOnSince: null, activeSeconds: 0,
  updatedAt: '2026-07-11T12:00:00.000Z', timerEnabled: false,
  authorization: 'approved',
  approvedScope: {
    authorizationPurpose: null, customerSuppliedPartsNote: 'Customer supplied unopened lift kit.',
    lines: [{ kind: 'labor', description: 'Install lift kit', hours: '2' }],
  },
}

function workProjection(
  overrides: Partial<{
    status: 'open' | 'in_progress' | 'done'
    workNotes: string | null
    startedAt: string | null
    completedAt: string | null
    clockedOnSince: string | null
    activeSeconds: number
    updatedAt: string
    timerEnabled: boolean
  }> = {},
) {
  return {
    status: 'in_progress' as const,
    workNotes: null,
    startedAt: '2026-07-11T12:01:00.000Z',
    completedAt: null,
    clockedOnSince: null,
    activeSeconds: 0,
    updatedAt: '2026-07-11T12:01:00.000Z',
    timerEnabled: false,
    ...overrides,
  }
}

describe('simple work workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => REQUEST) })
  })

  it('uses Start work as the only dominant action before work begins', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ changed: true, work: workProjection() }), {
        status: 200,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={base} />)

    expect(screen.getByRole('button', { name: 'Start work' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /clock/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start work' }))
    await screen.findByRole('heading', { name: 'Work in progress' })
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/tickets/${TICKET}/jobs/${JOB}/work`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          action: 'start_work',
          expectedUpdatedAt: base.updatedAt,
        }),
      }),
    )
    expect(screen.getByRole('button', { name: 'Complete as approved' })).toBeEnabled()
  })

  it('keeps detail optional and completes it in the same dominant action', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        changed: true,
        work: workProjection({
          status: 'done',
          workNotes: 'Measured final ride height.',
          completedAt: '2026-07-11T12:05:00.000Z',
          updatedAt: '2026-07-11T12:05:00.000Z',
        }),
      }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const inProgress = {
      ...base,
      workStatus: 'in_progress' as const,
      startedAt: '2026-07-11T12:01:00.000Z',
    }
    const { container } = render(
      <SimpleWorkWorkspace ticket={ticket} initialWorkspace={inProgress} />,
    )

    expect(screen.getByRole('button', { name: 'Complete as approved' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Add detail' })).toBeEnabled()
    expect(container.textContent).not.toMatch(/\bnotes?\b/i)

    fireEvent.click(screen.getByRole('button', { name: 'Add detail' }))
    const detail = screen.getByRole('textbox', {
      name: 'Anything worth recording? (optional)',
    })
    fireEvent.change(detail, { target: { value: '  Measured final ride height.  ' } })
    expect(screen.getByRole('button', { name: 'Complete with detail' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Complete with detail' }))
    await screen.findByRole('heading', { name: 'Work complete' })
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/tickets/${TICKET}/jobs/${JOB}/work`,
      expect.objectContaining({
        body: JSON.stringify({
          action: 'complete',
          expectedUpdatedAt: inProgress.updatedAt,
          completion: {
            kind: 'with_details',
            details: 'Measured final ride height.',
          },
        }),
      }),
    )
  })

  it('shows timer controls only for an enabled timer or a clock that still needs stopping', () => {
    const inProgress = { ...base, workStatus: 'in_progress' as const }
    const { rerender } = render(
      <SimpleWorkWorkspace ticket={ticket} initialWorkspace={inProgress} />,
    )
    expect(screen.queryByRole('button', { name: 'Clock on' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clock off' })).not.toBeInTheDocument()

    rerender(
      <SimpleWorkWorkspace
        key="enabled"
        ticket={ticket}
        initialWorkspace={{ ...inProgress, timerEnabled: true }}
      />,
    )
    expect(screen.getByRole('button', { name: 'Clock on' })).toBeInTheDocument()
    expect(screen.getByText(/not payroll/i)).toBeInTheDocument()

    rerender(
      <SimpleWorkWorkspace
        key="running-disabled"
        ticket={ticket}
        initialWorkspace={{
          ...inProgress,
          timerEnabled: false,
          clockedOnSince: '2026-07-11T12:01:00.000Z',
        }}
      />,
    )
    expect(screen.getByRole('button', { name: 'Clock off' })).toBeInTheDocument()
  })

  it.each([
    ['a timeout', () => Promise.reject(new TypeError('lost response'))],
    ['an invalid envelope', () => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))],
    ['a conflict', () => Promise.resolve(new Response(JSON.stringify({ error: 'conflict' }), { status: 409 }))],
    ['a server error', () => Promise.resolve(new Response(null, { status: 500 }))],
  ])('reconciles Start work after %s', async (_scenario, firstResult) => {
    const next = {
      ...base,
      workStatus: 'in_progress' as const,
      startedAt: '2026-07-11T12:01:00.000Z',
      updatedAt: '2026-07-11T12:01:00.000Z',
    }
    const fetchMock = vi.fn()
      .mockImplementationOnce(firstResult)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        workspace: next,
        partRequests: [],
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={base} />)

    fireEvent.click(screen.getByRole('button', { name: 'Start work' }))

    await screen.findByRole('heading', { name: 'Work in progress' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/tickets/${TICKET}/jobs/${JOB}/work`,
      { method: 'GET', cache: 'no-store' },
    )
  })

  it('keeps a detail draft when an ambiguous outcome still cannot be confirmed', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('lost response'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ bad: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SimpleWorkWorkspace
      ticket={ticket}
      initialWorkspace={{ ...base, workStatus: 'in_progress' }}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Add detail' }))
    const detail = screen.getByRole('textbox', {
      name: 'Anything worth recording? (optional)',
    })
    fireEvent.change(detail, { target: { value: 'My measured detail.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete with detail' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't confirm what happened",
    )
    expect(detail).toHaveValue('My measured detail.')
  })

  it('shows both local and server detail when the saved baseline changed elsewhere', async () => {
    const localScope = {
      actorProfileId: ACTOR,
      ticketId: TICKET,
      jobId: JOB,
      workStatus: 'in_progress' as const,
      authorization: 'approved' as const,
      savedDetailBaseline: 'Original saved detail.',
    }
    const encoded = encodeSimpleWorkDraft(localScope, {
      detail: 'My local detail.',
      detailOpen: true,
      concern: '',
      tier: '',
      parts: { description: '', preference: '', quantity: '1', requestKey: null },
      hold: { kind: '', note: '' },
    })
    expect(encoded).not.toBeNull()
    sessionStorage.setItem(simpleWorkDraftStorageKey(localScope), encoded as string)

    render(<SimpleWorkWorkspace
      actorProfileId={ACTOR}
      ticket={ticket}
      initialWorkspace={{
        ...base,
        workStatus: 'in_progress',
        workNotes: 'Saved elsewhere.',
      }}
    />)

    expect(await screen.findByText('Your detail')).toBeInTheDocument()
    expect(screen.getByText('My local detail.')).toBeInTheDocument()
    expect(screen.getByText('Saved elsewhere')).toBeInTheDocument()
    expect(screen.getByText('Saved elsewhere.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use my detail' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Use saved detail' })).toBeEnabled()
  })

  it('shows the immutable approved scope before work actions without exposing prices', () => {
    const { container } = render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={base} />)
    const scope = screen.getByRole('region', { name: /exactly what is approved/i })
    expect(scope).toHaveTextContent('Install lift kit')
    expect(scope).toHaveTextContent('2 labor hours')
    expect(scope).toHaveTextContent('Customer supplied unopened lift kit.')
    expect(scope.compareDocumentPosition(screen.getByRole('heading', { name: /approved and ready/i })))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(container.textContent).not.toMatch(/\$|price|cost|vendor/i)
  })

  it('focuses the approved scope when mounted inside the technician handoff', async () => {
    render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={base} embedded />)

    await waitFor(() => expect(
      screen.getByRole('heading', { name: 'Exactly what is approved' }),
    ).toHaveFocus())
    expect(screen.getByRole('button', { name: 'Start work' })).toBeEnabled()
  })

  it('restores the current technician draft after a reload without changing the repair-order route', async () => {
    const workspace = { ...base, workStatus: 'in_progress' as const }
    const scope = {
      actorProfileId: ACTOR,
      ticketId: TICKET,
      jobId: JOB,
      workStatus: workspace.workStatus,
      authorization: 'approved' as const,
      savedDetailBaseline: '',
    }
    const encoded = encodeSimpleWorkDraft(scope, {
      detail: 'Front-left bolts are ready for final torque.',
      detailOpen: true,
      concern: 'Rear brake squeal after road test',
      tier: '2',
      parts: { description: 'Pad hardware kit', preference: 'Motorcraft', quantity: '1', requestKey: REQUEST },
      hold: { kind: 'parts', note: 'Waiting for the pad hardware.' },
    })
    expect(encoded).not.toBeNull()
    sessionStorage.setItem(simpleWorkDraftStorageKey(scope), encoded as string)

    render(<SimpleWorkWorkspace
      actorProfileId={ACTOR}
      ticket={ticket}
      initialWorkspace={workspace}
      embedded
    />)

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Anything worth recording? (optional)' }))
      .toHaveValue('Front-left bolts are ready for final torque.'))
    fireEvent.click(screen.getByText('Found another concern'))
    expect(screen.getByRole('textbox', { name: 'Concern' })).toHaveValue('Rear brake squeal after road test')
    expect(screen.getByLabelText('Who can do it')).toHaveValue('2')
    expect(screen.getByLabelText('What part do you need?')).toHaveValue('Pad hardware kit')
    fireEvent.click(screen.getAllByText('Put work on hold')[0])
    expect(screen.getByLabelText('Reason for hold')).toHaveValue('parts')
    expect(screen.getByLabelText('What needs to happen next?')).toHaveValue('Waiting for the pad hardware.')
  })

  it('renders distinct not-approved and declined states without mutation controls', () => {
    const { rerender } = render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={{ ...base, authorization: 'awaiting_approval' }} />)
    expect(screen.getByRole('heading', { name: 'Work not approved' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start work' })).toBeNull()
    rerender(<SimpleWorkWorkspace key="declined" ticket={ticket} initialWorkspace={{ ...base, authorization: 'declined' }} />)
    expect(screen.getByRole('heading', { name: 'Customer declined this work' })).toBeInTheDocument()
    expect(screen.queryByText('Waiting for customer approval')).toBeNull()
  })

  it('renders diagnostics-off manual diagnostic work as diagnostic work', () => {
    render(<SimpleWorkWorkspace
      ticket={ticket}
      initialWorkspace={{ ...base, kind: 'diagnostic', title: 'Brake squeal diagnosis' }}
    />)
    expect(screen.getByText('Diagnostic · assigned work')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start work' })).toBeEnabled()
  })

  it('clocks on only after a strict confirmed server response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ changed: true, work: { status: 'in_progress', workNotes: null, startedAt: '2026-07-11T12:01:00.000Z', completedAt: null, clockedOnSince: '2026-07-11T12:01:00.000Z', activeSeconds: 0, updatedAt: '2026-07-11T12:01:00.000Z', timerEnabled: true } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={{ ...base, workStatus: 'in_progress', timerEnabled: true }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clock on' }))
    await screen.findByText(/Running since/)
    expect(fetchMock).toHaveBeenCalledWith(`/api/tickets/${TICKET}/jobs/${JOB}/work`, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ action: 'clock_on' }),
    }))
  })

  it('embeds the existing work surface and publishes confirmed work without a page shell', async () => {
    const onClose = vi.fn()
    const onProjection = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ changed: true, work: { status: 'in_progress', workNotes: null, startedAt: '2026-07-11T12:01:00.000Z', completedAt: null, clockedOnSince: null, activeSeconds: 0, updatedAt: '2026-07-11T12:01:00.000Z', timerEnabled: false } }),
    }))

    render(<SimpleWorkWorkspace
      ticket={ticket}
      initialWorkspace={base}
      embedded
      onClose={onClose}
      onProjection={onProjection}
    />)

    expect(screen.queryByText('Work order 000007')).toBeNull()
    expect(screen.queryByRole('link', { name: 'View repair order' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Start work' }))
    await screen.findByRole('heading', { name: 'Work in progress' })
    expect(onProjection).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'in_progress' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close work' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps embedded work open while any technician draft is unsaved', () => {
    const onClose = vi.fn()
    render(<SimpleWorkWorkspace
      ticket={ticket}
      initialWorkspace={{ ...base, workStatus: 'in_progress' }}
      embedded
      onClose={onClose}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Add detail' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Anything worth recording? (optional)' }), {
      target: { value: 'Unsaved torque detail' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Close work' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Finish or clear the draft before closing work.')

    fireEvent.change(screen.getByRole('textbox', { name: 'Anything worth recording? (optional)' }), { target: { value: '' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'What part do you need?' }), {
      target: { value: 'Water pump' },
    })
    expect(screen.getByRole('button', { name: 'Complete as approved' })).toBeDisabled()
    expect(screen.getByText('Finish or clear the parts draft before completing.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close work' }))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Discard local draft' }))
    expect(screen.queryByRole('textbox', { name: 'Anything worth recording? (optional)' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'What part do you need?' })).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Close work' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('makes hold available as soon as a parts request is saved', async () => {
    const created = {
      id: '00000000-0000-4000-8000-000000000041', jobId: JOB, description: 'Front brake pad set',
      preference: 'OE-equivalent', quantity: 1, status: 'requested', requestedAt: '2026-07-19T12:01:00.000Z', resolvedAt: null,
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 201, json: async () => ({ request: created }),
    }))
    render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={{
      ...base, workStatus: 'in_progress', workNotes: 'Pads verified for replacement.',
    }} />)

    fireEvent.change(screen.getByLabelText('What part do you need?'), { target: { value: created.description } })
    fireEvent.change(screen.getByLabelText(/Brand or where to get it/), { target: { value: created.preference } })
    fireEvent.click(screen.getByRole('button', { name: 'Send to parts' }))
    await screen.findByText(created.description)
    fireEvent.click(screen.getByText('Put work on hold', { selector: 'summary' }))
    fireEvent.change(screen.getByLabelText('Reason for hold'), { target: { value: 'parts' } })
    fireEvent.change(screen.getByLabelText('What needs to happen next?'), { target: { value: 'Wait for the parts desk.' } })

    const holdForm = screen.getByLabelText('Reason for hold').closest('form') as HTMLFormElement
    expect(within(holdForm).getByRole('button', { name: 'Put work on hold' })).toBeEnabled()
  })

  it('keeps older saved detail without requiring it to be typed again', () => {
    render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={{
      ...base,
      workStatus: 'in_progress',
      workNotes: 'Installed and torqued.',
    }} />)
    expect(screen.getByRole('button', { name: 'Complete as approved' })).toBeEnabled()
    expect(screen.queryByRole('textbox', { name: 'Anything worth recording? (optional)' })).not.toBeInTheDocument()
  })

  it('renders one calm work rail without media controls or required writing', () => {
    const { container } = render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={{ ...base, workStatus: 'in_progress' }} />)
    expect(screen.getByRole('heading', { name: 'Finish this job' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Complete as approved' })).toBeEnabled()
    expect(container.textContent).not.toMatch(/\bnotes?\b/i)
    expect(container.querySelector('input[type="file"]')).toBeNull()
    expect(container.querySelector('[capture]')).toBeNull()
    expect(container.textContent).not.toMatch(/proof|photo|upload|filename|download/i)
  })

  it('sends found work to be quoted and reports its unassigned truth', async () => {
    const onEscalation = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 201,
      json: async () => ({ changed: true, job: { id: REQUEST, title: 'Found: steering clunk', kind: 'repair', requiredSkillTier: 2, assignedTechId: null, workStatus: 'open', approvalState: 'pending_quote', sessionId: null } }),
    }))
    render(<SimpleWorkWorkspace
      ticket={ticket}
      initialWorkspace={{ ...base, workStatus: 'in_progress' }}
      onEscalation={onEscalation}
    />)
    expect(screen.getByLabelText('Concern')).not.toBeVisible()
    fireEvent.click(screen.getByText('Found another concern'))
    fireEvent.change(screen.getByLabelText('Concern'), { target: { value: 'Steering clunk' } })
    fireEvent.change(screen.getByLabelText('Who can do it'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send to be quoted' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Sent to be quoted. It is on the ticket, unassigned until the advisor prices it.')
    expect(onEscalation).toHaveBeenCalledWith(expect.objectContaining({
      id: REQUEST,
      title: 'Found: steering clunk',
      approvalState: 'pending_quote',
    }))
    expect(screen.queryByText(/needs.*approval/i)).toBeNull()
  })

  it('replaces stale mutation UI with ticket context after a not-found response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'not_found' }) }))
    render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start work' }))
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(`/tickets/${TICKET}`))
  })

  it('replaces every embedded mutation with stale recovery after access changes', async () => {
    const onClose = vi.fn()
    const onStale = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'not_found' }),
    }))
    render(<SimpleWorkWorkspace
      ticket={ticket}
      initialWorkspace={base}
      embedded
      onClose={onClose}
      onStale={onStale}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Start work' }))

    const staleHeading = await screen.findByRole('heading', { name: 'Work access changed' })
    expect(staleHeading).toHaveFocus()
    expect(onStale).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Start work' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Finish this job' })).toBeNull()
    expect(screen.queryByText('Put work on hold')).toBeNull()
    expect(screen.queryByText('Found another concern')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send to parts' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Review repair order' })).toHaveAttribute(
      'href',
      `/tickets/${TICKET}`,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close work' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders completed work as text-only read-only history', () => {
    render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={{
      ...base, workStatus: 'done', workNotes: 'Installed and verified.',
    }} />)
    expect(screen.getByRole('heading', { name: 'Work complete' })).toBeInTheDocument()
    expect(screen.getByText('Installed and verified.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /proof|photo|attachment|download/i })).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows total time on the job and when it finished, once complete', () => {
    render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={{
      ...base, workStatus: 'done', workNotes: 'Installed and verified.',
      activeSeconds: 8_100, clockedOnSince: null, completedAt: '2026-07-11T11:29:00.000Z',
    }} />)
    expect(screen.getByText('Finished')).toBeInTheDocument()
    const onJob = screen.getByText('On the job').closest('div') as HTMLElement
    expect(within(onJob).getByText('2h 15m')).toBeInTheDocument()
  })

  it('shows a running total and a clock-off control while clocked on', () => {
    render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={{
      ...base, workStatus: 'in_progress', clockedOnSince: '2026-07-11T09:14:00.000Z', activeSeconds: 600,
    }} />)
    expect(screen.getByText('On the job')).toBeInTheDocument()
    expect(screen.getByText(/Running since/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clock off' })).toBeInTheDocument()
    expect(screen.queryByText('Finished')).toBeNull()
  })

  it('server-renders the persisted running total before the browser starts ticking', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-07-11T10:14:00.000Z').getTime())
    const html = renderToString(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={{
      ...base, workStatus: 'in_progress', clockedOnSince: '2026-07-11T09:14:00.000Z', activeSeconds: 600,
    }} />)

    expect(html).toContain('10m')
    expect(html).not.toContain('1h 10m')
    now.mockRestore()
  })

  it('shows a paused total and a clock-on control while clocked off', () => {
    render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={{
      ...base, workStatus: 'in_progress', clockedOnSince: null, activeSeconds: 8_100, timerEnabled: true,
    }} />)
    const onJob = screen.getByText('On the job').closest('div') as HTMLElement
    expect(within(onJob).getByText('2h 15m')).toBeInTheDocument()
    expect(screen.getByText('Paused')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clock on' })).toBeInTheDocument()
  })

  it('puts work on a durable hold from the mounted work surface without losing a draft', async () => {
    const onInterrupted = vi.fn()
    const onClose = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        changed: true,
        job: {
          id: JOB, assignedTechId: '00000000-0000-4000-8000-000000000001',
          workStatus: 'blocked', holdKind: 'parts', holdNote: 'Waiting for the lift-kit hardware.',
          holdResumeStatus: 'in_progress', heldAt: '2026-07-21T16:00:00.000Z',
          heldByProfileId: '00000000-0000-4000-8000-000000000001', clockedOnSince: null,
          activeSeconds: 120, updatedAt: '2026-07-21T16:00:00.000Z',
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<SimpleWorkWorkspace
      ticket={ticket}
      initialWorkspace={{ ...base, workStatus: 'in_progress' }}
      embedded
      onInterrupted={onInterrupted}
      onClose={onClose}
    />)

    fireEvent.click(screen.getAllByText('Put work on hold')[0])
    fireEvent.change(screen.getByLabelText('Reason for hold'), { target: { value: 'parts' } })
    fireEvent.change(screen.getByLabelText('What needs to happen next?'), {
      target: { value: 'Waiting for the lift-kit hardware.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Put work on hold' }))

    await waitFor(() => expect(onInterrupted).toHaveBeenCalledWith(expect.objectContaining({
      id: JOB, workStatus: 'blocked', holdKind: 'parts',
    })))
    expect(fetchMock).toHaveBeenCalledWith(`/api/tickets/${TICKET}/jobs/${JOB}/interruption`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'block', requestKey: REQUEST, holdKind: 'parts',
        holdNote: 'Waiting for the lift-kit hardware.',
      }),
    }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not let a technician lose unsaved detail by putting work on hold', () => {
    render(<SimpleWorkWorkspace
      ticket={ticket}
      initialWorkspace={{ ...base, workStatus: 'in_progress' }}
      embedded
    />)
    fireEvent.click(screen.getByRole('button', { name: 'Add detail' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Anything worth recording? (optional)' }), {
      target: { value: 'Torque values are still unsaved.' },
    })
    fireEvent.click(screen.getAllByText('Put work on hold')[0])
    fireEvent.change(screen.getByLabelText('Reason for hold'), { target: { value: 'parts' } })
    fireEvent.change(screen.getByLabelText('What needs to happen next?'), { target: { value: 'Awaiting clips.' } })

    expect(screen.getByRole('button', { name: 'Put work on hold' })).toBeDisabled()
    expect(screen.getByText('Clear the open draft before placing work on hold.')).toBeInTheDocument()
  })

  it('protects long technician-controlled strings from narrow-screen overflow', () => {
    const css = readFileSync(join(process.cwd(), 'components/screens/simple-work-workspace.module.css'), 'utf8')
    expect(css).toMatch(/\.hero h1[^}]*overflow-wrap: anywhere/)
    expect(css).toMatch(/\.savedNote[^}]*overflow-wrap: anywhere/)
    expect(css).toMatch(/\.approvedScope h2:focus-visible[^}]*outline:\s*2px solid var\(--vt-focus-ring\)/)
    expect(css).toMatch(/\.primary, \.secondary, \.ticketLink[^}]*min-height:\s*44px/)
    expect(css).toMatch(/\.closeEmbedded[^}]*min-width:\s*44px[^}]*min-height:\s*44px/)
    expect(css).not.toMatch(/proofList|primaryFile|secondaryFile|retryRow/)
  })
})
