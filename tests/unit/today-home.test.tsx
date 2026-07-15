import { afterEach, describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TodayHome as TodayHomeComponent } from '@/components/screens/today-home'
import type { Session } from '@/lib/db/schema'
import type { DueFollowUp } from '@/lib/comeback/list'
import type { TodayTicketJobs } from '@/lib/tickets'
import type { ComponentProps, ImgHTMLAttributes } from 'react'

function TodayHome(props: ComponentProps<typeof TodayHomeComponent>) {
  return <TodayHomeComponent diagnosticsEntitled {...props} />
}

vi.mock('next/image', () => ({
  default: (props: ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
}))
vi.mock('@/components/vt/whats-new-badge', () => ({ WhatsNewBadge: () => null }))

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

const todayJobs: TodayTicketJobs = {
  myJobs: [
    {
      id: 'job-mine',
      ticketId: 'ticket-mine',
      ticketNumber: 41,
      customerName: 'Morgan Lee',
      vehicle: { year: 2018, make: 'Honda', model: 'Accord' },
      title: 'Trace intermittent no-start',
      kind: 'diagnostic',
      requiredSkillTier: 2,
      sessionId: 'session-linked',
      workStatus: 'in_progress',
    },
  ],
  openJobs: [
    {
      id: 'job-open',
      ticketId: 'ticket-open',
      ticketNumber: 42,
      customerName: null,
      vehicle: null,
      title: 'Replace front brake pads',
      kind: 'repair',
      requiredSkillTier: 1,
      sessionId: null,
      workStatus: 'open',
    },
  ],
  linkedSessionIds: ['session-linked'],
}

describe('TodayHome', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not expose a standalone new-diagnosis entrance', () => {
    render(
      <TodayHome
        techName="Brandon"
        inProgress={[baseSession]}
        closedToday={[]}
      />,
    )
    expect(screen.queryByRole('link', { name: /new diagnosis/i })).toBeNull()
  })

  it('keeps the empty state pointed at ShopOS work', () => {
    render(
      <TodayHome techName="Brandon" inProgress={[]} closedToday={[]} />,
    )
    expect(screen.queryByRole('link', { name: /new diagnosis/i })).toBeNull()
    expect(screen.getByText(/new work orders and quick tickets appear here/i)).toBeInTheDocument()
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

  it('adds persisted My Jobs and Open Jobs without removing legacy Today sections', () => {
    render(
      <TodayHome
        techName="Brandon"
        inProgress={[baseSession]}
        closedToday={[closedSession]}
        dueFollowUps={[dueFollowUp]}
        todayJobs={todayJobs}
      />,
    )

    expect(screen.getByRole('region', { name: 'Ticket jobs' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'My jobs' })).toBeInTheDocument()
    expect(screen.getByText('Trace intermittent no-start')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Open jobs' })).toBeInTheDocument()
    expect(screen.getByText('Replace front brake pads')).toBeInTheDocument()
    expect(screen.getByText(/Check-ins · 1/i)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'In progress' })).toBeInTheDocument()
    expect(screen.getByText(/Closed today · 1/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /new diagnosis/i })).toBeNull()
  })

  it('does not show legacy empty guidance when ticket work exists', () => {
    render(
      <TodayHome
        techName="Brandon"
        inProgress={[]}
        closedToday={[]}
        todayJobs={todayJobs}
      />,
    )

    expect(screen.queryByText(/No work orders yet/i)).not.toBeInTheDocument()
  })

  it.each([
    {
      label: 'safe winner',
      response: {
        error: 'assignment_conflict',
        currentAssignee: { fullName: 'Winner Tech' },
      },
      announcement: 'Already claimed by Winner Tech',
    },
    {
      label: 'generic winner',
      response: { error: 'assignment_conflict' },
      announcement: 'This job was already claimed',
    },
  ])(
    'keeps the $label race announcement mounted after refreshed jobs become empty',
    async ({ response, announcement }) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => response,
      }))
      const openOnly: TodayTicketJobs = {
        myJobs: [],
        openJobs: [todayJobs.openJobs[0]],
        linkedSessionIds: [],
      }
      const emptyJobs: TodayTicketJobs = {
        myJobs: [],
        openJobs: [],
        linkedSessionIds: [],
      }
      const { rerender } = render(
        <TodayHome
          techName="Brandon"
          inProgress={[]}
          closedToday={[]}
          todayJobs={openOnly}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Claim job' }))
      await waitFor(() => {
        expect(screen.getByRole('status')).toHaveTextContent(announcement)
      })

      rerender(
        <TodayHome
          techName="Brandon"
          inProgress={[]}
          closedToday={[]}
          todayJobs={emptyJobs}
        />,
      )

      expect(screen.queryByRole('article')).toBeNull()
      expect(screen.getByRole('status')).toHaveTextContent(announcement)
    },
  )

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

  it('defaults to an honest ShopOS surface with no diagnostic engine entrance', () => {
    render(
      <TodayHomeComponent
        techName="Avery"
        inProgress={[baseSession]}
        closedToday={[closedSession]}
        dueFollowUps={[dueFollowUp]}
        canWriteCounterOrder
        canCreateTickets
        todayJobs={todayJobs}
      />,
    )

    expect(screen.getByRole('link', { name: 'New work order' })).toHaveAttribute('href', '/intake')
    expect(screen.getByRole('link', { name: 'Quick ticket' })).toHaveAttribute('href', '/tickets/new')
    expect(screen.getByRole('link', { name: 'Record findings' })).toHaveAttribute(
      'href',
      '/tickets/ticket-mine/quote',
    )
    expect(screen.queryByRole('link', { name: /new diagnosis|open diagnosis|view case/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /start diagnosis/i })).toBeNull()
    expect(screen.queryByText('Diagnose with AI — add-on')).toBeNull()
    expect(screen.queryByRole('region', { name: 'In progress' })).toBeNull()
    expect(screen.queryByText(/Closed today/i)).toBeNull()
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
