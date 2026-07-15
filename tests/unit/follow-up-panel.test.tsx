import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FollowUpPanel } from '@/components/comeback/follow-up-panel'
import type { DueFollowUp } from '@/lib/comeback/list'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

const sampleItem: DueFollowUp = {
  id: '11111111-1111-1111-1111-111111111111',
  sessionId: '22222222-2222-2222-2222-222222222222',
  kind: '7d',
  dueAt: new Date('2026-05-04T12:00:00Z'),
  surfacedAt: new Date('2026-05-04T14:00:00Z'),
  intake: {
    vehicleYear: 2013,
    vehicleMake: 'Ford',
    vehicleModel: 'F-150',
    vehicleEngine: '3.5L EcoBoost',
    customerComplaint: 'lost power on highway',
  },
}

describe('FollowUpPanel', () => {
  it('renders nothing when items is empty', () => {
    const { container } = render(<FollowUpPanel items={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the vehicle and the kind label for each item', () => {
    render(<FollowUpPanel items={[sampleItem]} />)
    expect(screen.getByText(/2013 Ford F-150/i)).toBeTruthy()
    expect(screen.getByText(/7-day check-in/i)).toBeTruthy()
  })

  it('renders Held and Came back buttons for each item', () => {
    render(<FollowUpPanel items={[sampleItem]} />)
    expect(screen.getByRole('button', { name: /held/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /came back/i })).toBeTruthy()
  })

  it('renders a legacy case link only when diagnostics are explicitly available', () => {
    render(<FollowUpPanel items={[sampleItem]} diagnosticsAvailable />)
    const link = screen.getByRole('link', { name: /view case/i })
    expect(link).toHaveProperty(
      'href',
      expect.stringContaining(`/sessions/${sampleItem.sessionId}`),
    )
  })

  it('keeps follow-up actions usable while omitting the diagnostic case link by default', () => {
    render(<FollowUpPanel items={[sampleItem]} />)

    expect(screen.getByRole('button', { name: /held/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /came back/i })).toBeEnabled()
    expect(screen.queryByRole('link', { name: /view case/i })).toBeNull()
    expect(document.querySelector('a[href^="/sessions/"]')).toBeNull()
  })

  it('renders an optional notes textarea', () => {
    render(<FollowUpPanel items={[sampleItem]} />)
    const ta = screen.getByPlaceholderText(/what happened/i)
    expect(ta).toBeTruthy()
    expect(ta.tagName.toLowerCase()).toBe('textarea')
  })

  it('renders the count in the module label', () => {
    render(<FollowUpPanel items={[sampleItem, { ...sampleItem, id: 'abc', kind: '30d' }]} />)
    expect(screen.getByLabelText(/check-ins/i)).toBeTruthy()
  })

  // 2026-05-08 plain-English audit pass: shop-slang "How did it hold?" → "Did
  // the fix hold up?". Lock the new wording so a future copy edit doesn't
  // silently regress to jargon.
  it('renders the plain-English check-in prompt "Did the fix hold up?"', () => {
    render(<FollowUpPanel items={[sampleItem]} />)
    expect(screen.getByText(/did the fix hold up\?/i)).toBeInTheDocument()
    // And: the old shop-slang phrasing should NOT be present.
    expect(screen.queryByText(/how did it hold\?/i)).not.toBeInTheDocument()
  })
})
