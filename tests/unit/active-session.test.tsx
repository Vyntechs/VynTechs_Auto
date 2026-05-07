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

const repairingSession: Session = {
  ...doneSession,
  treeState: {
    ...doneSession.treeState,
    phase: 'repairing',
    diagnosisLockedAt: '2026-05-07T10:21:12Z',
  },
} as unknown as Session

describe('ActiveSession — diagnosing-active path', () => {
  it('renders Close case link pointing to /sessions/[id]/outcome', () => {
    render(<ActiveSession session={session} />)
    const link = screen.getByRole('link', { name: /close case/i })
    expect(link).toHaveAttribute('href', `/sessions/${session.id}/outcome`)
  })
})

describe('ActiveSession — phase routing', () => {
  it('routes to DiagnosisProposedReview when done=true and phase=undefined', () => {
    render(<ActiveSession session={doneSession} />)

    // Hallmark: "Diagnosis proposed" Module label + "Lock in diagnosis & start repair" button.
    expect(screen.getByText(/diagnosis proposed/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /lock in diagnosis/i }),
    ).toBeInTheDocument()
    // Content surfaces the rootCauseSummary, AI message, and recommended repair.
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
  })

  it('routes to DiagnosisProposedReview when done=true and phase=diagnosing (explicit)', () => {
    const explicit: Session = {
      ...doneSession,
      treeState: { ...doneSession.treeState, phase: 'diagnosing' },
    } as unknown as Session
    render(<ActiveSession session={explicit} />)
    expect(
      screen.getByRole('button', { name: /lock in diagnosis/i }),
    ).toBeInTheDocument()
  })

  it('routes to RepairPhaseView when phase=repairing', () => {
    render(<ActiveSession session={repairingSession} events={[]} />)
    // Hallmark of RepairPhaseView: "Diagnosis locked" Module header +
    // "Repair done & verified — close case" link.
    expect(screen.getByText(/diagnosis locked/i)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /repair done & verified/i }),
    ).toBeInTheDocument()
    // Lock-in button NOT shown — past the review phase.
    expect(
      screen.queryByRole('button', { name: /lock in diagnosis/i }),
    ).not.toBeInTheDocument()
  })
})
