import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TodayHome } from '@/components/screens/today-home'
import type { Session } from '@/lib/db/schema'

const baseSession: Session = {
  id: '00000000-0000-0000-0000-000000000001',
  shopId: 'shop-1',
  techId: 'tech-1',
  status: 'open',
  intake: {
    customerComplaint: 'Lost power on highway',
    vehicle: {
      year: 2013,
      make: 'Ford',
      model: 'F-150',
      trim: '3.5 EcoBoost',
      mileage: 159000,
    },
  },
  treeState: {
    nodes: [],
    currentNodeId: null,
    done: false,
    message: null,
    requestedArtifact: null,
    proposedAction: null,
    gateDecision: null,
  },
  createdAt: new Date('2026-05-04T12:00:00Z'),
  closedAt: null,
  outcome: null,
} as unknown as Session

describe('TodayHome', () => {
  it('renders persistent New diagnosis CTA in header when sessions exist', () => {
    render(
      <TodayHome
        techName="Brandon"
        inProgress={[baseSession]}
        queued={[]}
        closedToday={[]}
      />,
    )
    const link = screen.getByRole('link', { name: /new diagnosis/i })
    expect(link).toHaveAttribute('href', '/sessions/new')
  })

  it('renders New diagnosis CTA in empty state too', () => {
    render(
      <TodayHome techName="Brandon" inProgress={[]} queued={[]} closedToday={[]} />,
    )
    const links = screen.getAllByRole('link', { name: /new diagnosis/i })
    expect(links.length).toBeGreaterThanOrEqual(1)
    expect(links[0]).toHaveAttribute('href', '/sessions/new')
  })
})
