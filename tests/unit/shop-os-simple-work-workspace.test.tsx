import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  updatedAt: '2026-07-11T12:00:00.000Z', authorization: 'approved', hasCompletionProof: false,
  attachments: [],
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
      json: async () => ({ changed: true, work: { status: 'in_progress', workNotes: null, updatedAt: '2026-07-11T12:01:00.000Z' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start work' }))
    await screen.findByRole('heading', { name: 'Work in progress' })
    expect(fetchMock).toHaveBeenCalledWith(`/api/tickets/${TICKET}/jobs/${JOB}/work`, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ action: 'start' }),
    }))
  })

  it('saves the explicit note and gates completion on authoritative proof truth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ changed: true, work: { status: 'in_progress', workNotes: 'Installed and torqued.', updatedAt: '2026-07-11T12:02:00.000Z' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const inProgress = { ...base, workStatus: 'in_progress' as const }
    const { unmount } = render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={inProgress} />)
    expect(screen.getByRole('button', { name: 'Complete work' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Work note' }), { target: { value: ' Installed and torqued. ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    await waitFor(() => expect(screen.getByText('Work note saved.')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Complete work' })).toBeDisabled()
    unmount()
    render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={{ ...inProgress, workNotes: 'Installed and torqued.', hasCompletionProof: true }} />)
    expect(screen.getByRole('button', { name: 'Complete work' })).toBeEnabled()
  })

  it('retains an uncertain file for an exact retry and sends no storage path', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ changed: true, attachment: { id: REQUEST, kind: 'photo', mimeType: 'image/jpeg', byteSize: 4, createdAt: '2026-07-11T12:03:00.000Z' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ workspace: { ...base, workStatus: 'in_progress', hasCompletionProof: true, attachments: [{ id: REQUEST, kind: 'photo', mimeType: 'image/jpeg', byteSize: 4, createdAt: '2026-07-11T12:03:00.000Z' }] } }) })
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={{ ...base, workStatus: 'in_progress' }} />)
    const input = container.querySelector('input[data-proof-camera]') as HTMLInputElement
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'proof.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved')
    fireEvent.click(screen.getByRole('button', { name: 'Retry proof upload' }))
    await waitFor(() => expect(screen.getByText('Proof uploaded.')).toBeInTheDocument())
    const firstForm = fetchMock.mock.calls[0][1].body as FormData
    const retryForm = fetchMock.mock.calls[1][1].body as FormData
    expect(firstForm.get('requestKey')).toBe(REQUEST)
    expect(retryForm.get('requestKey')).toBe(REQUEST)
    expect(JSON.stringify(await Promise.all([...retryForm.entries()].map(async ([key, value]) => [key, typeof value === 'string' ? value : value.name])))).not.toContain('storageKey')
  })

  it('keeps found concern optional and reports only unassigned/unstarted truth', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 201,
      json: async () => ({ changed: true, job: { id: REQUEST, title: 'Diagnose: steering clunk', kind: 'diagnostic', requiredSkillTier: 2, assignedTechId: null, workStatus: 'open', approvalState: 'pending_quote', sessionId: null } }),
    }))
    render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={{ ...base, workStatus: 'in_progress' }} />)
    expect(screen.getByLabelText('Concern')).not.toBeVisible()
    fireEvent.click(screen.getByText('Found another concern'))
    fireEvent.change(screen.getByLabelText('Concern'), { target: { value: 'Steering clunk' } })
    fireEvent.change(screen.getByLabelText('Required skill tier'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create diagnostic job' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Diagnostic job added. It is unassigned and unstarted.')
    expect(screen.queryByText(/needs.*approval/i)).toBeNull()
  })

  it('replaces stale mutation UI with ticket context after a not-found response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'not_found' }) }))
    render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start work' }))
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(`/tickets/${TICKET}`))
  })

  it('renders completed work as read-only history with proxy-only proof links', () => {
    render(<SimpleWorkWorkspace ticket={ticket} initialWorkspace={{
      ...base, workStatus: 'done', workNotes: 'Installed and verified.', hasCompletionProof: true,
      attachments: [{ id: REQUEST, kind: 'photo', mimeType: 'image/jpeg', byteSize: 4, createdAt: '2026-07-11T12:03:00.000Z' }],
    }} />)
    expect(screen.getByRole('heading', { name: 'Work complete' })).toBeInTheDocument()
    expect(screen.getByText('Installed and verified.')).toBeInTheDocument()
    const proof = screen.getByRole('link', { name: /open photo proof/i })
    expect(proof).toHaveAttribute('href', `/api/tickets/${TICKET}/jobs/${JOB}/attachments/${REQUEST}`)
    expect(proof.getAttribute('href')).not.toMatch(/storage|token|supabase/i)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
