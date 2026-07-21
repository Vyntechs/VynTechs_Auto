import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TodayTicketJobs } from '@/lib/tickets'

const { redirectError, redirectMock } = vi.hoisted(() => {
  const redirectError = new Error('NEXT_REDIRECT')
  return {
    redirectError,
    redirectMock: vi.fn(() => {
      throw redirectError
    }),
  }
})

vi.mock('next/navigation', () => ({ redirect: redirectMock }))
vi.mock('@/lib/auth', () => ({
  requireUserAndProfile: vi.fn(),
  isFounder: vi.fn(() => false),
}))
vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(async () => ({})),
}))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/comeback/list', () => ({ listDueFollowUpsForTech: vi.fn() }))
vi.mock('@/lib/intake/team', () => ({ getShopTeam: vi.fn(async () => ({ members: [], workloadFailed: false })) }))
vi.mock('@/lib/tickets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tickets')>()
  return { ...actual, listTodayTicketJobs: vi.fn() }
})
vi.mock('@/components/screens/today-home', () => ({
  TodayHome: ({
    inProgress,
    closedToday,
    todayJobs,
    diagnosticsEntitled,
    canWriteCounterOrder,
    canDispatchWork,
  }: {
    inProgress: { id: string }[]
    closedToday: { id: string }[]
    todayJobs: TodayTicketJobs
    diagnosticsEntitled: boolean
    canWriteCounterOrder: boolean
    canDispatchWork: boolean
  }) => (
    <div>
      <span>ticket jobs {todayJobs.myJobs.length + todayJobs.openJobs.length + todayJobs.teamJobs.length + todayJobs.createdJobs.length}</span>
      <span>active sessions {inProgress.map((session) => session.id).join(',')}</span>
      <span>closed sessions {closedToday.map((session) => session.id).join(',')}</span>
      <span>diagnostics {String(diagnosticsEntitled)}</span>
      <span>counter intake {String(canWriteCounterOrder)}</span>
      <span>dispatch board {String(canDispatchWork)}</span>
    </div>
  ),
}))

import TodayPage from '@/app/(app)/today/page'
import { requireUserAndProfile } from '@/lib/auth'
import { listDueFollowUpsForTech } from '@/lib/comeback/list'
import { getShopTeam } from '@/lib/intake/team'
import { listTodayTicketJobs } from '@/lib/tickets'

const requireUserMock = vi.mocked(requireUserAndProfile)
const followUpsMock = vi.mocked(listDueFollowUpsForTech)
const shopTeamMock = vi.mocked(getShopTeam)
const todayJobsMock = vi.mocked(listTodayTicketJobs)

const profile = {
  id: 'tech-1',
  userId: 'user-1',
  shopId: 'shop-1',
  fullName: 'Taylor Tech',
  role: 'tech',
  skillTier: 2,
  membershipStatus: 'active' as const,
  membershipActivatedAt: new Date('2026-07-10T12:00:00Z'),
  isComp: false,
  isCurator: false,
  lastSeenWhatsNewAt: null,
  deactivatedAt: null,
  createdAt: new Date('2026-07-10T12:00:00Z'),
}
const actor = {
  profileId: profile.id,
  shopId: profile.shopId,
  role: profile.role,
  skillTier: profile.skillTier,
  membershipStatus: profile.membershipStatus,
  deactivatedAt: profile.deactivatedAt,
}

const jobs: TodayTicketJobs = {
  myJobs: [],
  openJobs: [
    {
      id: 'job-1',
      ticketId: 'ticket-1',
      ticketNumber: 77,
      concern: 'Customer reports a no-crank condition.',
      customerName: 'Safe Customer',
      vehicle: { year: 2020, make: 'Ford', model: 'Transit' },
      title: 'Diagnose no crank',
      kind: 'diagnostic',
      requiredSkillTier: 2,
      sessionId: 'linked-open',
      workStatus: 'open',
      approvalState: 'pending_quote',
      canClaim: true,
      assignmentState: 'unassigned',
      assignedTechName: null,
      createdByMe: false,
    },
  ],
  createdJobs: [],
  teamJobs: [],
  partsJobs: [],
  linkedSessionIds: ['linked-open', 'linked-closed'],
}

describe('TodayPage Shop OS composition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUserMock.mockResolvedValue({
      profile,
      user: { id: profile.userId, email: 'taylor@shop.test' },
    })
    followUpsMock.mockResolvedValue([])
    todayJobsMock.mockResolvedValue(jobs)
    shopTeamMock.mockResolvedValue({ members: [], workloadFailed: false })
  })

  it('redirects before loading Today data when unauthenticated', async () => {
    requireUserMock.mockResolvedValue(null)

    await expect(TodayPage()).rejects.toBe(redirectError)

    expect(todayJobsMock).not.toHaveBeenCalled()
    expect(followUpsMock).not.toHaveBeenCalled()
  })

  it('loads persisted ticket jobs with the translated actor', async () => {
    await TodayPage()

    expect(todayJobsMock).toHaveBeenCalledWith({}, { actor })
  })

  it('shows complete counter intake to advisors but not technicians', async () => {
    render(await TodayPage())
    expect(screen.getByText('counter intake false')).toBeInTheDocument()
    expect(screen.getByText('dispatch board false')).toBeInTheDocument()

    requireUserMock.mockResolvedValue({
      profile: { ...profile, role: 'advisor' },
      user: { id: profile.userId, email: 'taylor@shop.test' },
    })

    render(await TodayPage())
    expect(screen.getByText('counter intake true')).toBeInTheDocument()
    expect(screen.getByText('dispatch board true')).toBeInTheDocument()
  })

  it('keeps diagnostics and legacy sessions dark while preserving ticket work', async () => {
    render(await TodayPage())

    expect(screen.getByText('ticket jobs 1')).toBeInTheDocument()
    expect(screen.getByText('active sessions')).toBeInTheDocument()
    expect(screen.getByText('closed sessions')).toBeInTheDocument()
    expect(screen.getByText('diagnostics false')).toBeInTheDocument()
  })

  it('does not load diagnostic sessions and still loads the authorized ticket projection', async () => {
    render(await TodayPage())

    expect(screen.getByText('active sessions')).toBeInTheDocument()
    expect(screen.getByText('closed sessions')).toBeInTheDocument()
    expect(screen.getByText('diagnostics false')).toBeInTheDocument()
    expect(todayJobsMock).toHaveBeenCalledWith({}, { actor })
    expect(followUpsMock).toHaveBeenCalledWith({}, profile.id)
  })
})
