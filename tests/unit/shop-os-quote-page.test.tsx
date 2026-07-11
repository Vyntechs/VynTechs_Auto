import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TicketDetail } from '@/lib/tickets'
import type { QuoteBuilderResult } from '@/lib/shop-os/quotes'

const { notFoundError, redirectError, notFoundMock, redirectMock } = vi.hoisted(() => ({
  notFoundError: new Error('NEXT_NOT_FOUND'),
  redirectError: new Error('NEXT_REDIRECT'),
  notFoundMock: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  redirectMock: vi.fn(() => { throw new Error('NEXT_REDIRECT') }),
}))

vi.mock('next/navigation', () => ({ notFound: notFoundMock, redirect: redirectMock }))
vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ checkAccess: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/tickets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tickets')>()),
  getTicketDetail: vi.fn(),
}))
vi.mock('@/lib/shop-os/quotes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-os/quotes')>()),
  getQuoteBuilder: vi.fn(),
}))
vi.mock('@/components/screens/manual-quote-builder', () => ({
  ManualQuoteBuilder: ({ ticket, builder }: { ticket: TicketDetail; builder: QuoteBuilder }) => (
    <div>Quote screen {ticket.ticketNumber}; {builder.ticket.id}</div>
  ),
}))

import QuotePage from '@/app/(app)/tickets/[id]/quote/page'
import { requireUserAndProfile } from '@/lib/auth'
import { checkAccess } from '@/lib/auth-access'
import { getQuoteBuilder } from '@/lib/shop-os/quotes'
import { getTicketDetail } from '@/lib/tickets'

type QuoteBuilder = Extract<QuoteBuilderResult, { ok: true }>['builder']
const requireUserMock = vi.mocked(requireUserAndProfile)
const checkAccessMock = vi.mocked(checkAccess)
const getTicketMock = vi.mocked(getTicketDetail)
const getBuilderMock = vi.mocked(getQuoteBuilder)

const ticketId = '00000000-0000-0000-0000-000000000101'
const profile = {
  id: '00000000-0000-0000-0000-000000000201',
  userId: '00000000-0000-0000-0000-000000000301',
  shopId: '00000000-0000-0000-0000-000000000401',
  fullName: 'Avery Advisor', role: 'advisor', skillTier: 2,
  membershipStatus: 'active' as const,
  membershipActivatedAt: new Date('2026-07-10T12:00:00Z'),
  isComp: false, isCurator: false, lastSeenWhatsNewAt: null,
  deactivatedAt: null, createdAt: new Date('2026-07-10T12:00:00Z'),
}
const context = { profile, user: { id: profile.userId, email: 'avery@shop.test' } }
const ticket = {
  id: ticketId, ticketNumber: 101, source: 'counter', status: 'open',
  concern: 'Brake vibration', whenStarted: null, howOften: null,
  diagnosticAuthorizedCents: null, diagnosticAuthorizationNote: null,
  customer: null, vehicle: null, jobs: [],
  createdAt: new Date('2026-07-10T14:30:00Z'),
  updatedAt: new Date('2026-07-10T14:30:00Z'),
} satisfies TicketDetail
const builder = {
  ticket: { id: ticketId, status: 'open', reconciled: false },
  configuration: {
    laborRateCents: 12500, taxRateBps: 825,
    laborRateConfigured: true, taxRateConfigured: true,
  },
  jobs: [], activeVersion: null,
} satisfies QuoteBuilder
const props = () => ({ params: Promise.resolve({ id: ticketId }) })

describe('QuotePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUserMock.mockResolvedValue(context)
    checkAccessMock.mockResolvedValue({ kind: 'allow' })
    getTicketMock.mockResolvedValue({ ok: true, ticket })
    getBuilderMock.mockResolvedValue({ ok: true, builder })
  })

  it('redirects unauthenticated visitors before access or domain reads', async () => {
    requireUserMock.mockResolvedValue(null)
    await expect(QuotePage(props())).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith('/sign-in')
    expect(checkAccessMock).not.toHaveBeenCalled()
    expect(getTicketMock).not.toHaveBeenCalled()
  })

  it.each([
    [{ kind: 'deactivated' } as const, '/deactivated'],
    [{ kind: 'paywall', reason: 'unpaid' } as const, '/subscribe'],
  ])('redirects denied access before domain reads', async (access, target) => {
    checkAccessMock.mockResolvedValue(access)
    await expect(QuotePage(props())).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith(target)
    expect(getTicketMock).not.toHaveBeenCalled()
    expect(getBuilderMock).not.toHaveBeenCalled()
  })

  it('collapses unsupported capability before domain reads', async () => {
    requireUserMock.mockResolvedValue({
      ...context,
      profile: { ...profile, role: 'legacy_role' as typeof profile.role },
    })
    await expect(QuotePage(props())).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFoundMock).toHaveBeenCalledTimes(1)
    expect(getTicketMock).not.toHaveBeenCalled()
    expect(getBuilderMock).not.toHaveBeenCalled()
  })

  it('loads both safe projections directly with their exact actor forms', async () => {
    render(await QuotePage(props()))
    expect(getTicketMock).toHaveBeenCalledWith({}, {
      actor: {
        profileId: profile.id, shopId: profile.shopId, role: profile.role,
        skillTier: profile.skillTier, membershipStatus: profile.membershipStatus,
        deactivatedAt: null,
      },
      ticketId,
    })
    expect(getBuilderMock).toHaveBeenCalledWith({}, {
      actor: { profileId: profile.id }, ticketId,
    })
    expect(screen.getByText(`Quote screen 101; ${ticketId}`)).toBeInTheDocument()
  })

  it.each(['ticket', 'builder'] as const)('collapses %s cross-boundary denial to not-found', async (source) => {
    if (source === 'ticket') getTicketMock.mockResolvedValue({ ok: false, error: 'not_found' })
    else getBuilderMock.mockResolvedValue({ ok: false, error: 'not_found' })
    await expect(QuotePage(props())).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFoundMock).toHaveBeenCalledTimes(1)
  })
})
