import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { redirectMock, notFoundMock, workspaceScreenMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((target: string) => { throw new Error(`redirect:${target}`) }),
  notFoundMock: vi.fn(() => { throw new Error('not-found') }),
  workspaceScreenMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({ redirect: redirectMock, notFound: notFoundMock }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ checkAccess: vi.fn() }))
vi.mock('@/lib/shop-os/simple-work', () => ({ getSimpleWorkWorkspace: vi.fn() }))
vi.mock('@/lib/tickets', () => ({ getTicketDetail: vi.fn(), ticketActorFromProfile: vi.fn(() => ({ actor: true })) }))
vi.mock('@/components/screens/simple-work-workspace', () => ({
  SimpleWorkWorkspace: (props: unknown) => workspaceScreenMock(props) ?? <div>Simple work screen</div>,
}))

import SimpleWorkPage from '@/app/(app)/tickets/[id]/jobs/[jobId]/work/page'
import { requireUserAndProfile } from '@/lib/auth'
import { checkAccess } from '@/lib/auth-access'
import { getSimpleWorkWorkspace } from '@/lib/shop-os/simple-work'
import { getTicketDetail } from '@/lib/tickets'

const TICKET = '00000000-0000-4000-8000-000000000020'
const JOB = '00000000-0000-4000-8000-000000000030'
const profile = { id: '00000000-0000-4000-8000-000000000001', userId: 'user-1', shopId: '00000000-0000-4000-8000-000000000201', role: 'tech', skillTier: 2, membershipStatus: 'active', deactivatedAt: null }
const workspace = { id: JOB, title: 'Install lift kit', kind: 'repair', workStatus: 'open', workNotes: null, updatedAt: '2026-07-11T12:00:00.000Z', authorization: 'approved', hasCompletionProof: false, attachments: [] }
const ticket = { id: TICKET, ticketNumber: 7, status: 'open', customer: { id: 'private', name: 'Morgan Lee', phone: 'private', email: null }, vehicle: { id: 'private', year: 2020, make: 'Jeep', model: 'Wrangler', engine: 'private', vin: null, mileage: null, plate: null }, jobs: [] }
const props = { params: Promise.resolve({ id: TICKET, jobId: JOB }) }

describe('simple work page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUserAndProfile).mockResolvedValue({ user: { id: profile.userId }, profile } as never)
    vi.mocked(checkAccess).mockResolvedValue({ kind: 'allow' })
    vi.mocked(getSimpleWorkWorkspace).mockResolvedValue({ ok: true, workspace } as never)
    vi.mocked(getTicketDetail).mockResolvedValue({ ok: true, ticket } as never)
  })

  it('redirects authentication and access failures before domain reads', async () => {
    vi.mocked(requireUserAndProfile).mockResolvedValue(null)
    await expect(SimpleWorkPage(props)).rejects.toThrow('redirect:/sign-in')
    expect(getSimpleWorkWorkspace).not.toHaveBeenCalled()
    vi.mocked(requireUserAndProfile).mockResolvedValue({ user: { id: profile.userId }, profile } as never)
    vi.mocked(checkAccess).mockResolvedValue({ kind: 'paywall', reason: 'unpaid' })
    await expect(SimpleWorkPage(props)).rejects.toThrow('redirect:/subscribe')
  })

  it('loads exact assigned work and crosses only bounded ticket identity', async () => {
    render(await SimpleWorkPage(props))
    expect(getSimpleWorkWorkspace).toHaveBeenCalledWith({}, {
      actor: { profileId: profile.id, shopId: profile.shopId }, ticketId: TICKET, jobId: JOB,
    })
    expect(screen.getByText('Simple work screen')).toBeInTheDocument()
    expect(workspaceScreenMock).toHaveBeenCalledWith({
      ticket: { id: TICKET, number: 7, customerName: 'Morgan Lee', vehicle: '2020 Jeep Wrangler' },
      initialWorkspace: workspace,
    })
    expect(JSON.stringify(workspaceScreenMock.mock.calls[0][0])).not.toMatch(/phone|engine|vin|shopId/)
  })

  it.each(['work', 'ticket'] as const)('fails closed when %s truth is unavailable', async (source) => {
    if (source === 'work') vi.mocked(getSimpleWorkWorkspace).mockResolvedValue({ ok: false, error: 'not_found' })
    else vi.mocked(getTicketDetail).mockResolvedValue({ ok: false, error: 'not_found' } as never)
    await expect(SimpleWorkPage(props)).rejects.toThrow('not-found')
  })

  it('fails closed instead of rendering a dead page without customer/vehicle identity', async () => {
    vi.mocked(getTicketDetail).mockResolvedValue({ ok: true, ticket: { ...ticket, vehicle: null } } as never)
    await expect(SimpleWorkPage(props)).rejects.toThrow('not-found')
    expect(workspaceScreenMock).not.toHaveBeenCalled()
  })

  it('renders completed history returned by the authoritative workspace', async () => {
    vi.mocked(getSimpleWorkWorkspace).mockResolvedValue({
      ok: true, workspace: { ...workspace, workStatus: 'done', workNotes: 'Installed and verified.' },
    } as never)
    render(await SimpleWorkPage(props))
    expect(workspaceScreenMock.mock.calls[0][0].initialWorkspace).toMatchObject({ workStatus: 'done' })
  })
})
