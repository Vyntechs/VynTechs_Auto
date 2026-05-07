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

const doneSession: Session = {
  ...session,
  treeState: {
    nodes: [
      {
        id: 'n2',
        label: 'Replace booster + master cylinder, full bleed',
        status: 'active',
        rationale: 'Brake fluid in booster confirms backward leakage from master cylinder.',
      },
    ],
    currentNodeId: 'n2',
    done: true,
    message:
      'Brake fluid inside the booster locks this in. Master cylinder seal is compromised; both must be replaced together.',
    requestedArtifact: null,
    proposedAction: {
      description:
        'Replace booster and master cylinder as a matched pair; full four-corner bleed.',
      confidence: 0.98,
      expectedSignal: 'Firm pedal post-bleed; fuel trims within ±5% at idle.',
    },
    rootCauseSummary:
      'Brake booster crimp seam vacuum leak + master cylinder backward leakage.',
    gateDecision: null,
  },
} as unknown as Session

describe('ActiveSession', () => {
  it('renders Close case link pointing to /sessions/[id]/outcome', () => {
    render(<ActiveSession session={session} />)
    const link = screen.getByRole('link', { name: /close case/i })
    expect(link).toHaveAttribute('href', `/sessions/${session.id}/outcome`)
  })

  it('shows Diagnosis complete with root cause + safety message + repair plan when treeState.done is true', () => {
    // Regression for the 2026-05-07 bug where the auto-redirect to /outcome
    // hid the AI's diagnosis, repair plan, and safety message entirely.
    // The diagnosis-complete view is what the tech reads BEFORE deciding
    // to close the case.
    render(<ActiveSession session={doneSession} />)

    expect(screen.getByText(/diagnosis complete/i)).toBeInTheDocument()
    expect(
      screen.getByText(/brake booster crimp seam vacuum leak/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/master cylinder seal is compromised/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/replace booster and master cylinder as a matched pair/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/firm pedal post-bleed/i)).toBeInTheDocument()

    const link = screen.getByRole('link', { name: /close case/i })
    expect(link).toHaveAttribute('href', `/sessions/${doneSession.id}/outcome`)
  })
})
