import { describe, expect, it, vi } from 'vitest'

const { mockAuth, mockRecents, mockTeam, mockCannedList } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockRecents: vi.fn(),
  mockTeam: vi.fn(),
  mockCannedList: vi.fn(),
}))

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ db: { name: 'test-db' } }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/auth', () => ({ requireUserAndProfile: mockAuth }))
vi.mock('@/lib/intake/recent-customers', () => ({ getRecentIntakeCustomers: mockRecents }))
vi.mock('@/lib/intake/team', () => ({ getShopTeam: mockTeam }))
vi.mock('@/lib/shop-os/canned-jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shop-os/canned-jobs')>()
  return { ...actual, listCannedJobs: mockCannedList }
})

import IntakePage from '@/app/(app)/intake/page'
import { CounterIntake } from '@/components/screens/counter-intake'

describe('/intake page', () => {
  it('loads the shop work menu and passes diagnostic authorization context into the existing intake page', async () => {
    const diagnostic = {
      id: '11111111-1111-4111-8111-111111111111', title: 'Initial diagnosis', kind: 'diagnostic' as const,
      defaultRequiredSkillTier: 3 as const, sort: 10, fingerprint: 'a'.repeat(64),
      lines: [{ kind: 'labor' as const, description: 'Test and isolate', sort: 10, hours: '1', priceCents: 18_750, taxable: false, laborRateCents: 18_750 }],
      summary: { subtotalCents: 18_750, taxableSubtotalCents: 0, taxCents: 0, totalCents: 18_750 },
    }
    mockAuth.mockResolvedValue({
      user: { email: 'advisor@shop.test' },
      profile: { id: 'profile-1', shopId: 'shop-1', role: 'advisor' },
    })
    mockRecents.mockResolvedValue([])
    mockTeam.mockResolvedValue({ members: [], workloadFailed: false })
    mockCannedList.mockResolvedValue({ ok: true, cannedJobs: [diagnostic], taxRateBps: 825 })

    const result = await IntakePage()
    expect(result.type).toBe(CounterIntake)
    expect(result.props).toMatchObject({
      userEmail: 'advisor@shop.test',
      cannedJobs: [diagnostic],
      cannedTaxRateBps: 825,
      cannedCatalogAvailable: true,
    })
  })
})
