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
  startedAt: null, completedAt: null,
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
    expect(screen.queryByRole('button', { name: 'Start work' })).toBeNull()
    rerender(<SimpleWorkWorkspace key="declined" ticket={ticket} initialWorkspace={{ ...base, authorization: 'declined' }} />)
    expect(screen.getByRole('heading', { name: 'Customer declined this work' })).toBeInTheDocument()
    expect(screen.queryByText('Waiting for customer approval')).toBeNull()
  })

  it('starts work only after a strict confirmed server response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ changed: true, work: { status: 'in_progress', workNotes: null, startedAt: '2026-07-11T12:01:00.000Z', completedAt: null, updatedAt: '2026-07-11T12:01:00.000Z' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start work' }))
    await screen.findByRole('heading', { name: 'Work in progress' })
    expect(fetchMock).toHaveBeenCalledWith(`/api/tickets/${TICKET}/jobs/${JOB}/work`, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ action: 'start' }),
    }))
  })

  it('enables completion immediately after the server confirms a non-empty saved note', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ changed: true, work: { status: 'in_progress', workNotes: 'Installed and torqued.', startedAt: '2026-07-11T12:00:30.000Z', completedAt: null, updatedAt: '2026-07-11T12:02:00.000Z' } }),
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 201,
      json: async () => ({ changed: true, job: { id: REQUEST, title: 'Found: steering clunk', kind: 'repair', requiredSkillTier: 2, assignedTechId: null, workStatus: 'open', approvalState: 'pending_quote', sessionId: null } }),
    }))
    render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={{ ...base, workStatus: 'in_progress' }} />)
    expect(screen.getByLabelText('Concern')).not.toBeVisible()
    fireEvent.click(screen.getByText('Found another concern'))
    fireEvent.change(screen.getByLabelText('Concern'), { target: { value: 'Steering clunk' } })
    fireEvent.change(screen.getByLabelText('Required skill tier'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send to be quoted' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Sent to be quoted. It is on the ticket, unassigned until the advisor prices it.')
    expect(screen.queryByText(/needs.*approval/i)).toBeNull()
  })

  it('replaces stale mutation UI with ticket context after a not-found response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'not_found' }) }))
    render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start work' }))
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

  it('shows the job clock and how long it ran once complete', () => {
    render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={{
      ...base, workStatus: 'done', workNotes: 'Installed and verified.',
      startedAt: '2026-07-11T09:14:00.000Z', completedAt: '2026-07-11T11:29:00.000Z',
    }} />)
    expect(screen.getByText('Started')).toBeInTheDocument()
    expect(screen.getByText('Finished')).toBeInTheDocument()
    const onJob = screen.getByText('On the job').closest('div') as HTMLElement
    expect(within(onJob).getByText('2h 15m')).toBeInTheDocument()
  })

  it('shows only the start time while work is still in progress', () => {
    render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={{
      ...base, workStatus: 'in_progress', startedAt: '2026-07-11T09:14:00.000Z', completedAt: null,
    }} />)
    expect(screen.getByText('Started')).toBeInTheDocument()
    expect(screen.queryByText('Finished')).toBeNull()
    expect(screen.queryByText('On the job')).toBeNull()
  })

  it('protects long technician-controlled strings from narrow-screen overflow', () => {
    const css = readFileSync(join(process.cwd(), 'components/screens/simple-work-workspace.module.css'), 'utf8')
    expect(css).toMatch(/\.hero h1[^}]*overflow-wrap: anywhere/)
    expect(css).toMatch(/\.savedNote[^}]*overflow-wrap: anywhere/)
    expect(css).not.toMatch(/proofList|primaryFile|secondaryFile|retryRow/)
  })
})
