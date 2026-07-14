import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The EVIDENCE_RECEIPT_PREVIEW flag is server-side: /today resolves it and
// passes a boolean down. This test proves the env boolean actually reaches
// TodayHome (and defaults off), mirroring shop-os-today-page.test.tsx mocks.

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/auth', () => ({
  requireUserAndProfile: vi.fn(),
  isFounder: vi.fn(() => false),
}))
vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(async () => ({})),
}))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/db/queries', () => ({ listSessionsForShop: vi.fn(async () => []) }))
vi.mock('@/lib/comeback/list', () => ({ listDueFollowUpsForTech: vi.fn(async () => []) }))
vi.mock('@/lib/entitlements', () => ({ hasDiagnostics: vi.fn(async () => true) }))
vi.mock('@/lib/tickets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tickets')>()
  return {
    ...actual,
    listTodayTicketJobs: vi.fn(async () => ({
      myJobs: [],
      openJobs: [],
      linkedSessionIds: [],
    })),
  }
})
vi.mock('@/components/screens/today-home', () => ({
  TodayHome: ({ evidenceReceiptPreview }: { evidenceReceiptPreview?: boolean }) => (
    <div>receipt preview flag: {String(evidenceReceiptPreview)}</div>
  ),
}))

import TodayPage from '@/app/(app)/today/page'
import { requireUserAndProfile } from '@/lib/auth'

const requireUserMock = vi.mocked(requireUserAndProfile)

describe('TodayPage EVIDENCE_RECEIPT_PREVIEW wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUserMock.mockResolvedValue({
      profile: {
        id: 'tech-1',
        userId: 'user-1',
        shopId: 'shop-1',
        fullName: 'Taylor Tech',
        role: 'tech',
        skillTier: 2,
        membershipStatus: 'active',
        membershipActivatedAt: new Date('2026-07-10T12:00:00Z'),
        isComp: false,
        isCurator: false,
        lastSeenWhatsNewAt: null,
        deactivatedAt: null,
        createdAt: new Date('2026-07-10T12:00:00Z'),
      },
      user: { id: 'user-1', email: 'taylor@shop.test' },
    } as Awaited<ReturnType<typeof requireUserAndProfile>>)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('passes false when the env flag is unset (ships inert)', async () => {
    render(await TodayPage())

    expect(screen.getByText('receipt preview flag: false')).toBeInTheDocument()
  })

  it('passes true only when EVIDENCE_RECEIPT_PREVIEW=true', async () => {
    vi.stubEnv('EVIDENCE_RECEIPT_PREVIEW', 'true')

    render(await TodayPage())

    expect(screen.getByText('receipt preview flag: true')).toBeInTheDocument()
  })
})
