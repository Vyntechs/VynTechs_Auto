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
  updatedAt: '2026-07-11T12:00:00.000Z', authorization: 'approved',
  approvedScope: {
    authorizationPurpose: null, customerSuppliedPartsNote: 'Customer supplied unopened lift kit.',
    lines: [{ kind: 'labor', description: 'Install lift kit', hours: '2' }],
  },
}

describe('simple work workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => REQUEST) })
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

  it('restores the current technician draft after a reload without changing the repair-order route', async () => {
    const workspace = { ...base, workStatus: 'in_progress' as const }
    const scope = {
      actorProfileId: ACTOR,
      ticketId: TICKET,
      jobId: JOB,
      workspaceUpdatedAt: workspace.updatedAt,
      workStatus: workspace.workStatus,
      authorization: workspace.authorization,
    }
    const encoded = encodeSimpleWorkDraft(scope, {
      note: 'Front-left bolts are ready for final torque.',
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

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Work note' }))
      .toHaveValue('Front-left bolts are ready for final torque.'))
    fireEvent.click(screen.getByText('Found another concern'))
    expect(screen.getByRole('textbox', { name: 'Concern' })).toHaveValue('Rear brake squeal after road test')
    expect(screen.getByLabelText('Required skill tier')).toHaveValue('2')
    expect(screen.getByLabelText('What part do you need?')).toHaveValue('Pad hardware kit')
    fireEvent.click(screen.getAllByText('Put work on hold')[0])
    expect(screen.getByLabelText('Reason for hold')).toHaveValue('parts')
    expect(screen.getByLabelText('What needs to happen next?')).toHaveValue('Waiting for the pad hardware.')
  })

  it('renders distinct not-approved and declined states without mutation controls', () => {
    const { rerender } = render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={{ ...base, authorization: 'awaiting_approval' }} />)
    expect(screen.getByRole('heading', { name: 'Work not approved' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clock on' })).toBeNull()
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
    expect(screen.getByRole('button', { name: 'Clock on' })).toBeEnabled()
  })

  it('clocks on only after a strict confirmed server response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ changed: true, work: { status: 'in_progress', workNotes: null, startedAt: '2026-07-11T12:01:00.000Z', completedAt: null, clockedOnSince: '2026-07-11T12:01:00.000Z', activeSeconds: 0, updatedAt: '2026-07-11T12:01:00.000Z' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clock on' }))
    await screen.findByRole('heading', { name: 'Work in progress' })
    expect(fetchMock).toHaveBeenCalledWith(`/api/tickets/${TICKET}/jobs/${JOB}/work`, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ action: 'clock_on' }),
    }))
  })

  it('embeds the existing work surface and publishes confirmed work without a page shell', async () => {
    const onClose = vi.fn()
    const onProjection = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ changed: true, work: { status: 'in_progress', workNotes: null, startedAt: '2026-07-11T12:01:00.000Z', completedAt: null, clockedOnSince: '2026-07-11T12:01:00.000Z', activeSeconds: 0, updatedAt: '2026-07-11T12:01:00.000Z' } }),
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
    fireEvent.click(screen.getByRole('button', { name: 'Clock on' }))
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

    fireEvent.change(screen.getByRole('textbox', { name: 'Work note' }), {
      target: { value: 'Unsaved torque note' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Close work' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Finish or clear the draft before closing work.')

    fireEvent.change(screen.getByRole('textbox', { name: 'Work note' }), { target: { value: '' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'What part do you need?' }), {
      target: { value: 'Water pump' },
    })
    expect(screen.getByRole('button', { name: 'Complete work' })).toBeDisabled()
    expect(screen.getByText('Finish or clear the open concern or parts draft first.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close work' }))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Discard local draft' }))
    expect(screen.getByRole('textbox', { name: 'Work note' })).toHaveValue('')
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

  it('enables completion immediately after the server confirms a non-empty saved note', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ changed: true, work: { status: 'in_progress', workNotes: 'Installed and torqued.', startedAt: '2026-07-11T12:00:30.000Z', completedAt: null, clockedOnSince: '2026-07-11T12:00:30.000Z', activeSeconds: 0, updatedAt: '2026-07-11T12:02:00.000Z' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const inProgress = { ...base, workStatus: 'in_progress' as const }
    const { unmount } = render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={inProgress} />)
    expect(screen.getByRole('button', { name: 'Complete work' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Work note' }), { target: { value: ' Installed and torqued. ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    await waitFor(() => expect(screen.getByText('Work note saved.')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Complete work' })).toBeEnabled()
    unmount()
  })

  it('renders two text-only modules without media controls or copy', () => {
    const { container } = render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={{ ...base, workStatus: 'in_progress' }} />)
    expect(screen.getByRole('heading', { name: 'Work note' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Complete work' })).toBeInTheDocument()
    expect(screen.getByText('Requires a saved work note.')).toBeInTheDocument()
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
    fireEvent.change(screen.getByLabelText('Required skill tier'), { target: { value: '2' } })
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
    fireEvent.click(screen.getByRole('button', { name: 'Clock on' }))
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(`/tickets/${TICKET}`))
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

  it('shows a paused total and a clock-back-on control while clocked off', () => {
    render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={{
      ...base, workStatus: 'in_progress', clockedOnSince: null, activeSeconds: 8_100,
    }} />)
    const onJob = screen.getByText('On the job').closest('div') as HTMLElement
    expect(within(onJob).getByText('2h 15m')).toBeInTheDocument()
    expect(screen.getByText('Paused')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clock back on' })).toBeInTheDocument()
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

  it('does not let a technician lose an unsaved note by putting work on hold', () => {
    render(<SimpleWorkWorkspace
      ticket={ticket}
      initialWorkspace={{ ...base, workStatus: 'in_progress' }}
      embedded
    />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Work note' }), {
      target: { value: 'Torque values are still unsaved.' },
    })
    fireEvent.click(screen.getAllByText('Put work on hold')[0])
    fireEvent.change(screen.getByLabelText('Reason for hold'), { target: { value: 'parts' } })
    fireEvent.change(screen.getByLabelText('What needs to happen next?'), { target: { value: 'Awaiting clips.' } })

    expect(screen.getByRole('button', { name: 'Put work on hold' })).toBeDisabled()
    expect(screen.getByText('Save or clear the open draft before placing work on hold.')).toBeInTheDocument()
  })

  it('protects long technician-controlled strings from narrow-screen overflow', () => {
    const css = readFileSync(join(process.cwd(), 'components/screens/simple-work-workspace.module.css'), 'utf8')
    expect(css).toMatch(/\.hero h1[^}]*overflow-wrap: anywhere/)
    expect(css).toMatch(/\.savedNote[^}]*overflow-wrap: anywhere/)
    expect(css).not.toMatch(/proofList|primaryFile|secondaryFile|retryRow/)
  })
})
