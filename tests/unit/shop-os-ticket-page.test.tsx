import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TicketDetail, TicketDomainError } from '@/lib/tickets'

const { notFoundError, redirectError, notFoundMock, redirectMock } = vi.hoisted(() => {
  const notFoundError = new Error('NEXT_NOT_FOUND')
  const redirectError = new Error('NEXT_REDIRECT')

  return {
    notFoundError,
    redirectError,
    notFoundMock: vi.fn(() => {
      throw notFoundError
    }),
    redirectMock: vi.fn(() => {
      throw redirectError
    }),
  }
})

vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
  redirect: redirectMock,
}))

vi.mock('@/lib/auth', () => ({
  requireUserAndProfile: vi.fn(),
  isFounder: vi.fn(() => false),
}))

vi.mock('@/lib/auth-access', () => ({
  checkAccess: vi.fn(),
}))

vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(async () => ({})),
}))

vi.mock('@/lib/db/client', () => ({ db: {} }))

vi.mock('@/lib/tickets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tickets')>()
  return {
    ...actual,
    getTicketDetail: vi.fn(),
  }
})

vi.mock('@/lib/shop-os/part-requests', () => ({
  listPartRequestsForTicket: vi.fn(async () => []),
}))

vi.mock('@/lib/shop-os/parts-arrival', () => ({
  getPartsArrivalForTicket: vi.fn(async () => ({ ok: true, jobs: [] })),
}))

vi.mock('@/lib/shop-os/customer-copy', () => ({
  getCustomerCopyBundle: vi.fn(),
}))

vi.mock('@/app/(app)/tickets/[id]/customer-copy-actions', () => ({
  refreshCustomerCopy: vi.fn(),
}))

vi.mock('@/lib/intake/team', () => ({
  getShopTeam: vi.fn(async () => ({
    members: [{ id: 'tech-1', name: 'Toni Tech', skillTier: 3, isCurrentUser: false }],
    workloadFailed: false,
  })),
}))

vi.mock('@/components/screens/ticket-detail', () => ({
  TicketDetailScreen: ({ ticket, canBuildQuote, canCorrectTicket, canCreateVendorAccount, canManageCannedJobs, currentProfileId, role, team, diagnosticsEntitled, customerCopy, refreshCustomerCopyAction, partsArrival }: { ticket: TicketDetail; canBuildQuote: boolean; canCorrectTicket?: boolean; canCreateVendorAccount: boolean; canManageCannedJobs: boolean; currentProfileId: string; role: string; team: unknown[]; diagnosticsEntitled: boolean; customerCopy?: { documentKind: string } | null; refreshCustomerCopyAction?: unknown; partsArrival: unknown[] }) => (
    <div data-parts-arrival={String(partsArrival.length)} data-canned-library={String(canManageCannedJobs)} data-ticket-correction={String(canCorrectTicket === true)} data-customer-copy={customerCopy?.documentKind ?? 'none'} data-customer-copy-refresh={String(typeof refreshCustomerCopyAction === 'function')}>Ticket screen {ticket.ticketNumber}; quote {String(canBuildQuote)}; vendor setup {String(canCreateVendorAccount)}; actor {currentProfileId}; role {role}; team {team.length}; diagnostics {String(diagnosticsEntitled)}</div>
  ),
}))

import TicketPage from '@/app/(app)/tickets/[id]/page'
import { requireUserAndProfile } from '@/lib/auth'
import { checkAccess } from '@/lib/auth-access'
import { getShopTeam } from '@/lib/intake/team'
import { getTicketDetail } from '@/lib/tickets'
import { getCustomerCopyBundle } from '@/lib/shop-os/customer-copy'
import { customerCopyFixture } from '@/tests/helpers/customer-copy'

const requireUserMock = vi.mocked(requireUserAndProfile)
const checkAccessMock = vi.mocked(checkAccess)
const getTicketMock = vi.mocked(getTicketDetail)
const getShopTeamMock = vi.mocked(getShopTeam)
const getCustomerCopyBundleMock = vi.mocked(getCustomerCopyBundle)

const TICKET_ID = '00000000-0000-0000-0000-000000000101'
const profile = {
  id: '00000000-0000-0000-0000-000000000201',
  userId: '00000000-0000-0000-0000-000000000301',
  shopId: '00000000-0000-0000-0000-000000000401',
  fullName: 'Avery Advisor',
  role: 'advisor',
  skillTier: 2,
  jobTimerEnabled: false,
  membershipStatus: 'active' as const,
  membershipActivatedAt: new Date('2026-07-10T12:00:00Z'),
  isComp: false,
  isCurator: false,
  lastSeenWhatsNewAt: null,
  deactivatedAt: null,
  createdAt: new Date('2026-07-10T12:00:00Z'),
}
const authContext = {
  profile,
  user: { id: profile.userId, email: 'avery@shop.test' },
}
const actor = {
  profileId: profile.id,
  shopId: profile.shopId,
  role: profile.role,
  skillTier: profile.skillTier,
  membershipStatus: profile.membershipStatus,
  deactivatedAt: profile.deactivatedAt,
}
const timestamp = new Date('2026-07-10T14:30:00Z')
const ticket: TicketDetail = {
  id: TICKET_ID,
  ticketNumber: 101,
  source: 'counter',
  status: 'open',
  concern: 'Brake vibration',
  whenStarted: null,
  howOften: null,
  diagnosticAuthorizedCents: null,
  diagnosticAuthorizationNote: null,
  customer: null,
  vehicle: null,
  jobs: [],
  createdAt: timestamp,
  updatedAt: timestamp,
}

const pageProps = () => ({ params: Promise.resolve({ id: TICKET_ID }) })
const ringOut = {
  ticketId: TICKET_ID,
  status: 'open' as const,
  owed: { subtotalCents: 0, taxCents: 0, totalCents: 0, jobs: [] },
  paidCents: 0,
  balanceCents: 0,
  payments: [],
  canRecordPayment: false,
  canClose: true,
  closedAt: null,
}

describe('TicketPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    requireUserMock.mockResolvedValue(authContext)
    checkAccessMock.mockResolvedValue({ kind: 'allow', entitlements: { diagnostics: true } })
    getTicketMock.mockResolvedValue({ ok: true, ticket })
    getCustomerCopyBundleMock.mockResolvedValue({ ok: true, copy: customerCopyFixture, ringOut })
  })

  it('redirects unauthenticated visitors before ticket access', async () => {
    requireUserMock.mockResolvedValue(null)

    await expect(TicketPage(pageProps())).rejects.toBe(redirectError)

    expect(redirectMock).toHaveBeenCalledWith('/sign-in')
    expect(getTicketMock).not.toHaveBeenCalled()
    expect(checkAccessMock).not.toHaveBeenCalled()
  })

  it.each([
    [{ kind: 'deactivated' } as const, '/deactivated'],
    [{ kind: 'paywall', reason: 'past_due' } as const, '/subscribe'],
  ])('applies the access boundary before reading the ticket', async (access, target) => {
    checkAccessMock.mockResolvedValue(access)

    await expect(TicketPage(pageProps())).rejects.toBe(redirectError)

    expect(checkAccessMock).toHaveBeenCalledWith({}, profile.userId)
    expect(redirectMock).toHaveBeenCalledWith(target)
    expect(getTicketMock).not.toHaveBeenCalled()
  })

  it('forwards the exact translated actor and route ticket id', async () => {
    await TicketPage(pageProps())

    expect(getTicketMock).toHaveBeenCalledWith({}, {
      actor,
      ticketId: TICKET_ID,
    })
  })

  it('renders the ticket detail screen on success', async () => {
    render(await TicketPage(pageProps()))

    expect(screen.getByText(`Ticket screen 101; quote true; vendor setup false; actor ${profile.id}; role advisor; team 1; diagnostics true`)).toBeInTheDocument()
    expect(screen.getByText(/Ticket screen 101/)).toHaveAttribute('data-ticket-correction', 'true')
    expect(getShopTeamMock).toHaveBeenCalledWith({
      db: {},
      shopId: profile.shopId,
      currentUserId: profile.id,
    })
  })

  it.each([
    ['advisor', true],
    ['owner', true],
    ['tech', false],
    ['parts', false],
  ])('exposes correction only when the strict flag and %s capability both allow it', async (role, allowed) => {
    requireUserMock.mockResolvedValue({
      ...authContext,
      profile: { ...profile, role: role as typeof profile.role },
    })

    render(await TicketPage(pageProps()))

    expect(screen.getByText(/Ticket screen 101/)).toHaveAttribute(
      'data-ticket-correction',
      String(allowed),
    )
    expect(getTicketMock).toHaveBeenCalledTimes(1)
  })

  it('keeps correction and its client baseline loading absent when the strict flag is off', async () => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'false')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(await TicketPage(pageProps()))

    expect(screen.getByText(/Ticket screen 101/)).toHaveAttribute('data-ticket-correction', 'false')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getTicketMock).toHaveBeenCalledTimes(1)
  })

  it('loads and passes one server-shaped Customer Copy only for advisor/owner authority', async () => {
    render(await TicketPage(pageProps()))

    expect(getCustomerCopyBundleMock).toHaveBeenCalledWith({}, { actor, ticketId: TICKET_ID })
    expect(getCustomerCopyBundleMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Ticket screen 101/)).toHaveAttribute('data-customer-copy', 'invoice')
    expect(screen.getByText(/Ticket screen 101/)).toHaveAttribute('data-customer-copy-refresh', 'true')
  })

  it('never asks for or passes Customer Copy to a technician', async () => {
    requireUserMock.mockResolvedValue({
      ...authContext,
      profile: { ...profile, role: 'tech' },
    })

    render(await TicketPage(pageProps()))

    expect(getCustomerCopyBundleMock).not.toHaveBeenCalled()
    expect(screen.getByText(/Ticket screen 101/)).toHaveAttribute('data-customer-copy', 'none')
  })

  it('passes current diagnostics availability into the mounted repair order', async () => {
    checkAccessMock.mockResolvedValue({ kind: 'allow', entitlements: { diagnostics: false } })

    render(await TicketPage(pageProps()))

    expect(screen.getByText(`Ticket screen 101; quote true; vendor setup false; actor ${profile.id}; role advisor; team 1; diagnostics false`)).toBeInTheDocument()
    expect(checkAccessMock).toHaveBeenCalledWith({}, profile.userId)
  })

  it.each([
    ['owner', 'true'],
    ['advisor', 'false'],
    ['tech', 'false'],
  ])('hands canned-library authority to a %s as %s', async (role, granted) => {
    requireUserMock.mockResolvedValue({
      ...authContext,
      profile: { ...profile, role: role as typeof profile.role },
    })

    render(await TicketPage(pageProps()))

    expect(screen.getByText(/Ticket screen 101/)).toHaveAttribute('data-canned-library', granted)
  })

  it('keeps the ticket readable but omits quote entry for an unsupported role', async () => {
    requireUserMock.mockResolvedValue({
      ...authContext,
      profile: { ...profile, role: 'legacy_role' as typeof profile.role },
    })

    render(await TicketPage(pageProps()))

    expect(screen.getByText(`Ticket screen 101; quote false; vendor setup false; actor ${profile.id}; role legacy_role; team 0; diagnostics true`)).toBeInTheDocument()
  })

  it.each<TicketDomainError>([
    'forbidden',
    'no_shop',
    'inactive_profile',
    'invalid_input',
    'not_found',
    'invalid_assignee',
    'tier_confirmation_required',
    'ticket_not_open',
  ])('collapses %s to the same not-found boundary', async (error) => {
    getTicketMock.mockResolvedValue({ ok: false, error })

    await expect(TicketPage(pageProps())).rejects.toBe(notFoundError)

    expect(notFoundMock).toHaveBeenCalledTimes(1)
  })
})
