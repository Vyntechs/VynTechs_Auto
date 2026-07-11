import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TicketDetail } from '@/lib/tickets'
import type { QuoteBuilderResult } from '@/lib/shop-os/quotes'

const { notFoundError, redirectError, notFoundMock, redirectMock, manualBuilderMock } = vi.hoisted(() => ({
  notFoundError: new Error('NEXT_NOT_FOUND'),
  redirectError: new Error('NEXT_REDIRECT'),
  notFoundMock: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  redirectMock: vi.fn(() => { throw new Error('NEXT_REDIRECT') }),
  manualBuilderMock: vi.fn(),
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
vi.mock('@/lib/shop-os/canned-jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-os/canned-jobs')>()),
  listCannedJobs: vi.fn(),
}))
vi.mock('@/components/screens/manual-quote-builder', () => ({
  ManualQuoteBuilder: ({ ticket, builder, cannedJobs, cannedCatalogAvailable }: {
    ticket: TicketDetail; builder: QuoteBuilder; cannedJobs: unknown[]; cannedCatalogAvailable: boolean
  }) => (
    manualBuilderMock({ ticket, builder, cannedJobs, cannedCatalogAvailable })
      ?? <div>Quote screen {ticket.ticketNumber}; {builder.ticket.id}</div>
  ),
}))

import QuotePage from '@/app/(app)/tickets/[id]/quote/page'
import { requireUserAndProfile } from '@/lib/auth'
import { checkAccess } from '@/lib/auth-access'
import { getQuoteBuilder } from '@/lib/shop-os/quotes'
import { listCannedJobs } from '@/lib/shop-os/canned-jobs'
import { getTicketDetail } from '@/lib/tickets'

type QuoteBuilder = Extract<QuoteBuilderResult, { ok: true }>['builder']
const requireUserMock = vi.mocked(requireUserAndProfile)
const checkAccessMock = vi.mocked(checkAccess)
const getTicketMock = vi.mocked(getTicketDetail)
const getBuilderMock = vi.mocked(getQuoteBuilder)
const listCannedMock = vi.mocked(listCannedJobs)

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
    listCannedMock.mockResolvedValue({ ok: true, cannedJobs: [], taxRateBps: 825 })
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

  it('loads ticket, builder, and canned projections directly with their exact actor forms', async () => {
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
    expect(listCannedMock).toHaveBeenCalledWith({}, { actor: { profileId: profile.id } })
    expect(screen.getByText(`Quote screen 101; ${ticketId}`)).toBeInTheDocument()
    expect(manualBuilderMock.mock.calls[0][0]).toMatchObject({
      cannedJobs: [], cannedCatalogAvailable: true,
    })
  })

  it('keeps manual quoting available when the canned catalog is corrupt or tax-stale', async () => {
    listCannedMock.mockResolvedValueOnce({ ok: false, error: 'conflict', retryable: false })
    render(await QuotePage(props()))
    expect(manualBuilderMock.mock.calls[0][0]).toMatchObject({
      cannedJobs: [], cannedCatalogAvailable: false,
    })
    vi.clearAllMocks()
    requireUserMock.mockResolvedValue(context)
    checkAccessMock.mockResolvedValue({ kind: 'allow' })
    getTicketMock.mockResolvedValue({ ok: true, ticket })
    getBuilderMock.mockResolvedValue({ ok: true, builder })
    listCannedMock.mockResolvedValue({ ok: true, cannedJobs: [], taxRateBps: 700 })
    render(await QuotePage(props()))
    expect(manualBuilderMock.mock.calls[0][0]).toMatchObject({
      cannedJobs: [], cannedCatalogAvailable: false,
    })
  })

  it('keeps manual quoting available when the optional canned read rejects', async () => {
    listCannedMock.mockRejectedValueOnce(new Error('catalog unavailable'))
    render(await QuotePage(props()))
    expect(manualBuilderMock.mock.calls[0][0]).toMatchObject({
      cannedJobs: [], cannedCatalogAvailable: false,
    })
  })

  it('crosses the client boundary with only quote identity fields', async () => {
    getTicketMock.mockResolvedValue({
      ok: true,
      ticket: {
        ...ticket,
        concern: 'PRIVATE_CONCERN',
        customer: {
          id: 'customer-1', name: 'Marisol Vega', phone: 'PRIVATE_PHONE', email: 'PRIVATE_EMAIL',
        },
        vehicle: {
          id: 'vehicle-1', year: 2019, make: 'Ford', model: 'F-150', engine: 'PRIVATE_ENGINE',
          vin: 'PRIVATE_VIN', mileage: 88420, plate: 'PRIVATE_PLATE',
        },
      },
    })
    render(await QuotePage(props()))
    const clientTicket = manualBuilderMock.mock.calls[0][0].ticket
    expect(clientTicket).toEqual({
      id: ticketId,
      ticketNumber: 101,
      customer: { name: 'Marisol Vega' },
      vehicle: { year: 2019, make: 'Ford', model: 'F-150' },
    })
    expect(JSON.stringify(clientTicket)).not.toMatch(/PRIVATE_|customer-1|vehicle-1/)
  })

  it('renders a retry surface for initial quote lock contention', async () => {
    getBuilderMock.mockResolvedValue({ ok: false, error: 'conflict', retryable: true })
    render(await QuotePage(props()))
    expect(screen.getByRole('heading', { name: 'Quote is busy' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Retry quote' })).toHaveAttribute(
      'href',
      `/tickets/${ticketId}/quote`,
    )
    expect(notFoundMock).not.toHaveBeenCalled()
  })

  it.each(['ticket', 'builder'] as const)('collapses %s cross-boundary denial to not-found', async (source) => {
    if (source === 'ticket') getTicketMock.mockResolvedValue({ ok: false, error: 'not_found' })
    else getBuilderMock.mockResolvedValue({ ok: false, error: 'not_found' })
    await expect(QuotePage(props())).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFoundMock).toHaveBeenCalledTimes(1)
  })
})
