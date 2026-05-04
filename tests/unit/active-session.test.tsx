import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const { pushSpy, refreshSpy } = vi.hoisted(() => ({
  pushSpy: vi.fn(),
  refreshSpy: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushSpy, refresh: refreshSpy }),
}))

import { ActiveSession } from '@/components/screens/active-session'
import type { Session } from '@/lib/db/schema'

const session: Session = {
  id: '11111111-1111-1111-1111-111111111111',
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
    nodes: [
      {
        id: 'n1',
        label: 'Pull DTCs and freeze frame data',
        status: 'active',
        rationale: 'Establish what the truck saw before the symptom.',
      },
    ],
    currentNodeId: 'n1',
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

describe('ActiveSession', () => {
  it('renders Close case link pointing to /sessions/[id]/outcome', () => {
    render(<ActiveSession session={session} />)
    const link = screen.getByRole('link', { name: /close case/i })
    expect(link).toHaveAttribute('href', `/sessions/${session.id}/outcome`)
  })
})
