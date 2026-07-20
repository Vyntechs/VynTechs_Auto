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

vi.mock('@/lib/intake/team', () => ({
  getShopTeam: vi.fn(async () => ({
    members: [{ id: 'tech-1', name: 'Toni Tech', skillTier: 3, isCurrentUser: false }],
    workloadFailed: false,
  })),
}))

vi.mock('@/components/screens/ticket-detail', () => ({
  TicketDetailScreen: ({ ticket, canBuildQuote, canCreateVendorAccount, currentProfileId, role, team }: { ticket: TicketDetail; canBuildQuote: boolean; canCreateVendorAccount: boolean; currentProfileId: string; role: string; team: unknown[] }) => (
    <div>Ticket screen {ticket.ticketNumber}; quote {String(canBuildQuote)}; vendor setup {String(canCreateVendorAccount)}; actor {currentProfileId}; role {role}; team {team.length}</div>
  ),
}))

import TicketPage from '@/app/(app)/tickets/[id]/page'
import { requireUserAndProfile } from '@/lib/auth'
import { checkAccess } from '@/lib/auth-access'
import { getShopTeam } from '@/lib/intake/team'
import { getTicketDetail } from '@/lib/tickets'

const requireUserMock = vi.mocked(requireUserAndProfile)
const checkAccessMock = vi.mocked(checkAccess)
const getTicketMock = vi.mocked(getTicketDetail)
const getShopTeamMock = vi.mocked(getShopTeam)

const TICKET_ID = '00000000-0000-0000-0000-000000000101'
const profile = {
  id: '00000000-0000-0000-0000-000000000201',
  userId: '00000000-0000-0000-0000-000000000301',
  shopId: '00000000-0000-0000-0000-000000000401',
  fullName: 'Avery Advisor',
  role: 'advisor',
  skillTier: 2,
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

describe('TicketPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUserMock.mockResolvedValue(authContext)
    checkAccessMock.mockResolvedValue({ kind: 'allow', entitlements: { diagnostics: true } })
    getTicketMock.mockResolvedValue({ ok: true, ticket })
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

    expect(screen.getByText(`Ticket screen 101; quote true; vendor setup false; actor ${profile.id}; role advisor; team 1`)).toBeInTheDocument()
    expect(getShopTeamMock).toHaveBeenCalledWith({
      db: {},
      shopId: profile.shopId,
      currentUserId: profile.id,
    })
  })

  it('keeps the ticket readable but omits quote entry for an unsupported role', async () => {
    requireUserMock.mockResolvedValue({
      ...authContext,
      profile: { ...profile, role: 'legacy_role' as typeof profile.role },
    })

    render(await TicketPage(pageProps()))

    expect(screen.getByText(`Ticket screen 101; quote false; vendor setup false; actor ${profile.id}; role legacy_role; team 0`)).toBeInTheDocument()
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
