import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Session } from '@/lib/db/schema'

const { redirectMock, notFoundMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((target: string) => { throw new Error(`redirect:${target}`) }),
  notFoundMock: vi.fn(() => { throw new Error('not-found') }),
}))

vi.mock('next/navigation', () => ({ redirect: redirectMock, notFound: notFoundMock }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/sessions', () => ({ getSessionForUser: vi.fn() }))
vi.mock('@/lib/shop-os/repair-authorization', () => ({ resolveDiagnosticRepairAccess: vi.fn() }))
vi.mock('@/components/screens/outcome-capture', () => ({
  OutcomeCapture: () => <div>Performed repair outcome form</div>,
}))
vi.mock('@/components/screens/declined-no-repair-close', () => ({
  DeclinedNoRepairClose: () => <div>No repair closeout form</div>,
}))

import OutcomePage from '@/app/(app)/sessions/[id]/outcome/page'
import { requireUserAndProfile } from '@/lib/auth'
import { getSessionForUser } from '@/lib/sessions'
import { resolveDiagnosticRepairAccess } from '@/lib/shop-os/repair-authorization'

const sessionId = '11111111-1111-4111-8111-111111111111'
const ticketId = '22222222-2222-4222-8222-222222222222'
const jobId = '33333333-3333-4333-8333-333333333333'
const session = {
  id: sessionId,
  shopId: '44444444-4444-4444-8444-444444444444',
  techId: '55555555-5555-4555-8555-555555555555',
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
  },
  createdAt: new Date('2026-07-11T09:00:00.000Z'),
  closedAt: null,
  outcome: null,
} as unknown as Session

describe('ticket-backed session outcome page', () => {
  const props = { params: Promise.resolve({ id: sessionId }) }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUserAndProfile).mockResolvedValue({
      user: { id: 'user-1', email: 'tech@example.com' },
      profile: { id: session.techId, shopId: session.shopId } as never,
    })
    vi.mocked(getSessionForUser).mockResolvedValue({ ok: true, session: session as never })
    vi.mocked(resolveDiagnosticRepairAccess).mockResolvedValue({ state: 'legacy' })
  })

  it.each([
    { state: 'legacy' as const },
    {
      state: 'approved' as const,
      ticketId,
      jobId,
      quoteVersionId: '66666666-6666-4666-8666-666666666666',
    },
  ])('renders the performed-repair form for $state access', async (access) => {
    vi.mocked(resolveDiagnosticRepairAccess).mockResolvedValue(access)
    render(await OutcomePage(props))
    expect(screen.getByText('Performed repair outcome form')).toBeInTheDocument()
    expect(screen.queryByText('No repair closeout form')).not.toBeInTheDocument()
  })

  it('renders only the no-repair closeout for declined work', async () => {
    vi.mocked(resolveDiagnosticRepairAccess).mockResolvedValue({
      state: 'declined', ticketId, jobId,
    })
    render(await OutcomePage(props))
    expect(screen.getByText('No repair closeout form')).toBeInTheDocument()
    expect(screen.queryByText('Performed repair outcome form')).not.toBeInTheDocument()
  })

  it.each([
    { state: 'awaiting_approval' as const, ticketId, jobId },
    { state: 'unavailable' as const },
  ])('redirects $state direct URL access back to the session', async (access) => {
    vi.mocked(resolveDiagnosticRepairAccess).mockResolvedValue(access)
    await expect(OutcomePage(props)).rejects.toThrow(`redirect:/sessions/${sessionId}`)
  })

  it('redirects an already closed session before authorization lookup', async () => {
    vi.mocked(getSessionForUser).mockResolvedValue({
      ok: true,
      session: { ...session, status: 'closed' } as never,
    })
    await expect(OutcomePage(props)).rejects.toThrow(`redirect:/sessions/${sessionId}`)
    expect(resolveDiagnosticRepairAccess).not.toHaveBeenCalled()
  })
})
