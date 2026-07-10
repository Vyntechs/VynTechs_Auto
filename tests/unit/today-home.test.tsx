import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TodayHome } from '@/components/screens/today-home'
import type { Session } from '@/lib/db/schema'
import type { DueFollowUp } from '@/lib/comeback/list'

// The AppHeader subtree pulls in WhatsNewBadge (usePathname) and curator
// sidebar (useSearchParams indirectly via sibling routes), so the mock
// stubs every navigation hook the rendered subtree might reach.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/today',
  useSearchParams: () => new URLSearchParams(),
}))

const baseSession: Session = {
  id: '00000000-0000-0000-0000-000000000001',
  shopId: 'shop-1',
  techId: 'tech-1',
  status: 'open',
  intake: {
    vehicleYear: 2013,
    vehicleMake: 'Ford',
    vehicleModel: 'F-150',
    vehicleEngine: '3.5L EcoBoost',
    mileage: 159000,
    customerComplaint: 'Lost power on highway',
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

const closedSession: Session = {
  ...baseSession,
  id: '00000000-0000-0000-0000-000000000003',
  status: 'closed',
  closedAt: new Date('2026-05-04T13:00:00Z'),
} as unknown as Session

const dueFollowUp: DueFollowUp = {
  id: 'fu-1',
  sessionId: baseSession.id,
  kind: '7d',
  dueAt: new Date('2026-05-04T08:00:00Z'),
  surfacedAt: new Date('2026-05-04T08:00:00Z'),
  intake: baseSession.intake,
}

describe('TodayHome', () => {
  it('renders persistent New diagnosis CTA in header when sessions exist', () => {
    render(
      <TodayHome
        techName="Brandon"
        inProgress={[baseSession]}
        closedToday={[]}
      />,
    )
    const link = screen.getByRole('link', { name: /new diagnosis/i })
    expect(link).toHaveAttribute('href', '/sessions/new')
  })

  it('renders New diagnosis CTA in empty state too', () => {
    render(
      <TodayHome techName="Brandon" inProgress={[]} closedToday={[]} />,
    )
    const links = screen.getAllByRole('link', { name: /new diagnosis/i })
    expect(links.length).toBeGreaterThanOrEqual(1)
    expect(links[0]).toHaveAttribute('href', '/sessions/new')
  })

  it('renders modules in order: In-progress → Check-ins → Closed today', () => {
    const { container } = render(
      <TodayHome
        techName="Brandon"
        inProgress={[baseSession]}
        closedToday={[closedSession]}
        dueFollowUps={[dueFollowUp]}
      />,
    )

    const moduleLabels = Array.from(
      container.querySelectorAll<HTMLElement>('section.module'),
    ).map((el) => el.getAttribute('aria-label') ?? '')

    expect(moduleLabels.length).toBe(3)
    expect(moduleLabels[0]).toMatch(/^In progress$/i)
    expect(moduleLabels[1]).toMatch(/^Check-ins · 1$/i)
    expect(moduleLabels[2]).toMatch(/^Closed today · 1$/i)
  })

  it('does not render a Queued module', () => {
    const { container } = render(
      <TodayHome
        techName="Brandon"
        inProgress={[baseSession]}
        closedToday={[closedSession]}
        dueFollowUps={[dueFollowUp]}
      />,
    )
    const labels = Array.from(
      container.querySelectorAll<HTMLElement>('section.module'),
    ).map((el) => el.getAttribute('aria-label') ?? '')
    expect(labels.some((l) => /^Queued/i.test(l))).toBe(false)
  })

  it('Check-ins panel renders next to In progress and Closed today', () => {
    render(
      <TodayHome
        techName="Brandon"
        inProgress={[baseSession]}
        closedToday={[closedSession]}
        dueFollowUps={[dueFollowUp]}
      />,
    )
    expect(screen.getByText(/Check-ins · 1/i)).toBeInTheDocument()
    expect(screen.getByText(/In progress/i)).toBeInTheDocument()
    expect(screen.getByText(/Closed today · 1/i)).toBeInTheDocument()
  })

  it('renders a Reviewer link in the header when canCurate is true', () => {
    render(
      <TodayHome
        techName="Brandon"
        inProgress={[]}
        closedToday={[]}
        canCurate
      />,
    )
    const link = screen.getByRole('link', { name: /reviewer/i })
    expect(link).toHaveAttribute('href', '/curator')
  })

  it('does NOT render a Reviewer link when canCurate is false', () => {
    render(
      <TodayHome
        techName="Brandon"
        inProgress={[]}
        closedToday={[]}
        canCurate={false}
      />,
    )
    expect(screen.queryByRole('link', { name: /reviewer/i })).toBeNull()
  })

  it('renders a 44px Quick ticket entry when the active role can create tickets', () => {
    render(
      <TodayHome
        techName="Avery"
        inProgress={[]}
        closedToday={[]}
        canCreateTickets
      />,
    )
    const link = screen.getByRole('link', { name: 'Quick ticket' })
    expect(link).toHaveAttribute('href', '/tickets/new')
    expect(link).toHaveStyle({ minHeight: '44px' })
  })

  it('does not render the Quick ticket entry without the create capability', () => {
    render(<TodayHome techName="Avery" inProgress={[]} closedToday={[]} />)
    expect(screen.queryByRole('link', { name: 'Quick ticket' })).toBeNull()
  })
})

// 2026-05-29 trust sweep: every active row stamped a hardcoded "Risk · Low"
// (so two different jobs looked identical — the computer clearly didn't know
// one from the other) and showed a "step N / M" road-ahead count. Show the
// REAL risk class or none, and never preview the road ahead.
// docs/strategy/2026-05-29-customer-interaction-doctrine.md (§2.3, §3.4)
describe('TodayHome — honest risk + no road-ahead (trust sweep)', () => {
  const gatedSession: Session = {
    ...baseSession,
    id: '00000000-0000-0000-0000-000000000002',
    treeState: {
      ...baseSession.treeState,
      gateDecision: {
        allow: false,
        riskClass: 'destructive',
        threshold: 0.9,
        confidence: 0.5,
        rationale: 'high-risk action below threshold',
      },
    },
  } as unknown as Session

  const steppedSession: Session = {
    ...baseSession,
    id: '00000000-0000-0000-0000-000000000004',
    treeState: {
      ...baseSession.treeState,
      nodes: [
        { id: 'n1', label: 'Check battery voltage', status: 'active' },
        { id: 'n2', label: 'Check FICM', status: 'pending' },
      ],
      currentNodeId: 'n1',
    },
  } as unknown as Session

  it('does not stamp a fabricated "Risk · Low" on an active row with no gate decision', () => {
    render(<TodayHome techName="Brandon" inProgress={[baseSession]} closedToday={[]} />)
    expect(screen.queryByText(/Risk · Low/i)).toBeNull()
  })

  it('shows the real risk class when the session has a gate decision', () => {
    render(<TodayHome techName="Brandon" inProgress={[gatedSession]} closedToday={[]} />)
    expect(screen.getByText(/Risk · Destructive/i)).toBeInTheDocument()
    expect(screen.queryByText(/Risk · Low/i)).toBeNull()
  })

  it('does not show a "step N / M" road-ahead count on rows', () => {
    render(<TodayHome techName="Brandon" inProgress={[steppedSession]} closedToday={[]} />)
    expect(screen.queryByText(/step\s*\d+\s*\/\s*\d+/i)).toBeNull()
    expect(screen.queryByText(/\d+\s*steps/i)).toBeNull()
  })
})
