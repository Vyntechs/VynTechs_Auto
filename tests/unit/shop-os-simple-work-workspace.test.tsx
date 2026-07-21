import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SimpleWorkWorkspace } from '@/components/screens/simple-work-workspace'
import type { SimpleWorkWorkspaceView } from '@/lib/shop-os/simple-work-ui'

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
const ticket = { id: TICKET, number: 7, customerName: 'Morgan Lee', vehicle: '2020 Jeep Wrangler' }
const base: SimpleWorkWorkspaceView = {
  id: JOB, title: 'Install lift kit', kind: 'repair', workStatus: 'open', workNotes: null,
  startedAt: null, completedAt: null, clockedOnSince: null, activeSeconds: 0,
  updatedAt: '2026-07-11T12:00:00.000Z', authorization: 'approved',
}

describe('simple work workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => REQUEST) })
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

    fireEvent.change(screen.getByRole('textbox', { name: 'What part do you need?' }), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Close work' }))
    expect(onClose).toHaveBeenCalledTimes(1)
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
    expect(onClose).toHaveBeenCalledTimes(1)
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
