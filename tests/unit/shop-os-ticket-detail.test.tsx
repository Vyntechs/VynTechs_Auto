import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { TicketDetailScreen } from '@/components/screens/ticket-detail'
import type { TicketDetail } from '@/lib/tickets'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/tickets/ticket-1',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next/image', () => ({
  default: ({
    priority: _priority,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => <img {...props} />,
}))

vi.mock('@/components/vt/whats-new-badge', () => ({
  WhatsNewBadge: () => null,
}))

vi.mock('@/components/screens/inline-quote-workspace', () => ({
  InlineQuoteWorkspace: ({ onClose, onProjection }: {
    onClose: () => void
    onProjection: (jobs: Array<{
      id: string
      workStatus: 'open'
      approvalState: 'quote_ready'
    }>) => void
  }) => (
    <section aria-label="Inline quote workspace">
      <button type="button" onClick={() => onProjection([{
        id: 'job-1',
        workStatus: 'open',
        approvalState: 'quote_ready',
      }])}>Publish quote state</button>
      <button type="button" onClick={onClose}>Close quote</button>
    </section>
  ),
}))

vi.mock('@/components/screens/inline-work-workspace', () => ({
  InlineWorkWorkspace: ({ onClose, onProjection, onEscalation }: {
    onClose: () => void
    onProjection: (work: {
      status: 'done'
      workNotes: string
      startedAt: string
      completedAt: string
      clockedOnSince: null
      activeSeconds: number
      updatedAt: string
    }) => void
    onEscalation: (job: {
      id: string
      title: string
      kind: 'repair'
      requiredSkillTier: number
      assignedTechId: null
      workStatus: 'open'
      approvalState: 'pending_quote'
      sessionId: null
    }) => void
  }) => (
    <section aria-label="Inline work workspace">
      <button type="button" onClick={() => onProjection({
        status: 'done',
        workNotes: 'Installed and torqued.',
        startedAt: '2026-07-11T12:00:00.000Z',
        completedAt: '2026-07-11T13:00:00.000Z',
        clockedOnSince: null,
        activeSeconds: 3600,
        updatedAt: '2026-07-11T13:00:00.000Z',
      })}>Publish work state</button>
      <button type="button" onClick={() => onEscalation({
        id: 'found-job',
        title: 'Found: steering clunk',
        kind: 'repair',
        requiredSkillTier: 2,
        assignedTechId: null,
        workStatus: 'open',
        approvalState: 'pending_quote',
        sessionId: null,
      })}>Publish found concern</button>
      <button type="button" onClick={onClose}>Close work</button>
    </section>
  ),
}))

const timestamp = new Date('2026-07-10T14:30:00Z')

type TicketJob = TicketDetail['jobs'][number]

function job(overrides: Partial<TicketJob> = {}): TicketJob {
  return {
    id: 'job-1',
    title: 'Diagnose brake vibration',
    kind: 'diagnostic',
    requiredSkillTier: 3,
    assignedTechId: null,
    assignedTech: null,
    sessionId: null,
    workStatus: 'open',
    approvalState: 'pending_quote',
    workNotes: null,
    diagnosticStartState: 'idle',
    diagnosticStartErrorCode: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}

function ticket(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return {
    id: 'ticket-1',
    ticketNumber: 42,
    source: 'counter',
    status: 'open',
    concern: 'Steering wheel shakes under braking from highway speed.',
    whenStarted: 'Three days ago',
    howOften: 'Every stop above 50 mph',
    diagnosticAuthorizedCents: 18750,
    diagnosticAuthorizationNote: 'Call before exceeding the authorized amount.',
    customer: {
      id: 'customer-1',
      name: 'Marisol Vega',
      phone: '(214) 555-0197',
      email: 'marisol@example.com',
    },
    vehicle: {
      id: 'vehicle-1',
      year: 2019,
      make: 'Ford',
      model: 'F-150',
      engine: '3.5L EcoBoost',
      vin: '1FTFW1E41KFA00001',
      mileage: 88420,
      plate: 'TEX-4192',
    },
    jobs: [job()],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}

describe('TicketDetailScreen', () => {
  it('renders a complete counter ticket from the safe projection with real links', () => {
    render(<TicketDetailScreen ticket={ticket()} />)

    expect(screen.getAllByText('RO 000042').length).toBeGreaterThan(0)
    expect(screen.getByText('Open · Counter intake')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to My Jobs' })).toHaveAttribute(
      'href',
      '/today',
    )
    expect(
      screen.getByText('Steering wheel shakes under braking from highway speed.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Three days ago')).toBeInTheDocument()
    expect(screen.getByText('Every stop above 50 mph')).toBeInTheDocument()
    expect(screen.getByText('$187.50')).toBeInTheDocument()
    expect(
      screen.getByText('Call before exceeding the authorized amount.'),
    ).toBeInTheDocument()

    expect(screen.getAllByText('Marisol Vega')).toHaveLength(2)
    expect(screen.getByRole('link', { name: '(214) 555-0197' })).toHaveAttribute(
      'href',
      'tel:+12145550197',
    )
    expect(screen.getByRole('link', { name: 'marisol@example.com' })).toHaveAttribute(
      'href',
      'mailto:marisol@example.com',
    )
    expect(screen.getAllByText('2019 Ford F-150')).toHaveLength(2)
    expect(screen.getAllByText('3.5L EcoBoost')).toHaveLength(2)
    expect(screen.getByText('1FTFW1E41KFA00001')).toBeInTheDocument()
    expect(screen.getByText('88,420 mi')).toBeInTheDocument()
    expect(screen.getByText('TEX-4192')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View vehicle history' })).toHaveAttribute(
      'href',
      '/vehicles/vehicle-1',
    )
  })

  it('renders an honest provisional tech-quick state without invented actions or identity', () => {
    render(
      <TicketDetailScreen
        canBuildQuote
        ticket={ticket({
          source: 'tech_quick',
          customer: null,
          vehicle: null,
          whenStarted: null,
          howOften: null,
          diagnosticAuthorizedCents: null,
          diagnosticAuthorizationNote: null,
        })}
      />,
    )

    expect(screen.getByText('Open · Tech quick')).toBeInTheDocument()
    const provisional = screen.getByRole('region', {
      name: 'Customer and vehicle still needed',
    })
    expect(
      within(provisional).getByText(
        'Draft quote lines now. Prepare, send, approval, delivery, and closeout stay blocked until this ticket is reconciled.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Build quote' })).toHaveAttribute(
      'href',
      '/tickets/ticket-1/quote',
    )
    expect(within(provisional).queryByRole('button')).toBeNull()
    expect(screen.queryByText('Marisol Vega')).toBeNull()
    expect(screen.queryByText('2019 Ford F-150')).toBeNull()
  })

  it('offers one 44px quote entry only for an authorized open ticket', () => {
    const { rerender } = render(
      <TicketDetailScreen ticket={ticket()} canBuildQuote />,
    )

    expect(screen.getByRole('link', { name: 'Build quote' })).toHaveAttribute(
      'href',
      '/tickets/ticket-1/quote',
    )

    rerender(<TicketDetailScreen ticket={ticket()} canBuildQuote={false} />)
    expect(screen.queryByRole('link', { name: 'Build quote' })).toBeNull()

    rerender(
      <TicketDetailScreen
        ticket={ticket({ status: 'closed' })}
        canBuildQuote
      />,
    )
    expect(screen.queryByRole('link', { name: 'Build quote' })).toBeNull()
  })

  it('opens the role-shaped quote tool in place, reconciles ledger truth, and restores focus', async () => {
    const user = userEvent.setup()
    render(
      <TicketDetailScreen
        ticket={ticket()}
        canBuildQuote
        currentProfileId="advisor-1"
        role="advisor"
      />,
    )

    const opener = screen.getByRole('button', { name: 'Build quote' })
    expect(screen.queryByRole('link', { name: 'Build quote' })).toBeNull()
    await user.click(opener)

    expect(screen.getByRole('region', { name: 'Inline quote workspace' })).toBeInTheDocument()
    expect(screen.getByText('Steering wheel shakes under braking from highway speed.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Publish quote state' }))
    expect(screen.getByText('Approval · Quote ready')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close quote' }))
    expect(screen.queryByRole('region', { name: 'Inline quote workspace' })).toBeNull()
    expect(opener).toHaveFocus()
  })

  it('keeps the quote entry at least 44px with a visible focus treatment', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'components/screens/ticket-detail.module.css'),
      'utf8',
    )

    expect(css).toMatch(/\.quoteAction[\s\S]*min-block-size:\s*44px/)
    expect(css).toMatch(/\.quoteAction:focus-visible[\s\S]*outline:/)
  })

  it('labels quick_quote source as Quick ticket, not a completed quote', () => {
    render(<TicketDetailScreen ticket={ticket({ source: 'quick_quote' })} />)

    expect(screen.getByText('Open · Quick ticket')).toBeInTheDocument()
    expect(screen.queryByText('Open · Quick quote')).toBeNull()
  })

  it('fails closed for ambiguous contact actions and omits absent optional facts', () => {
    render(
      <TicketDetailScreen
        ticket={ticket({
          customer: {
            id: 'customer-1',
            name: 'Legacy Customer',
            phone: 'Call shop / ask for Lee',
            email: 'lee@example.com?subject=Override',
          },
          vehicle: {
            id: 'vehicle-1',
            year: 2004,
            make: 'Honda',
            model: 'Accord',
            engine: null,
            vin: null,
            mileage: null,
            plate: null,
          },
          diagnosticAuthorizedCents: null,
          diagnosticAuthorizationNote: null,
        })}
      />,
    )

    expect(screen.getByText('Call shop / ask for Lee')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Call shop / ask for Lee' })).toBeNull()
    expect(screen.getByText('lee@example.com?subject=Override')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'lee@example.com?subject=Override' }),
    ).toBeNull()
    expect(screen.queryByText('VIN')).toBeNull()
    expect(screen.queryByText('Mileage')).toBeNull()
    expect(screen.queryByText('Plate')).toBeNull()
    expect(screen.queryByText('Diagnostic authorization')).toBeNull()
  })

  it('preserves a deliberate phone extension in the dial target', () => {
    render(
      <TicketDetailScreen
        ticket={ticket({
          customer: {
            id: 'customer-1',
            name: 'Marisol Vega',
            phone: '(214) 555-0197 ext. 42',
            email: null,
          },
        })}
      />,
    )

    expect(
      screen.getByRole('link', { name: '(214) 555-0197 ext. 42' }),
    ).toHaveAttribute('href', 'tel:+12145550197;ext=42')
  })

  it('keeps the mobile AppHeader back target at least 44px', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'components/screens/ticket-detail.module.css'),
      'utf8',
    )

    expect(css).toMatch(/:global\(\.app-header__back\)[\s\S]*min-inline-size:\s*44px/)
    expect(css).toMatch(/:global\(\.app-header__back\)[\s\S]*min-block-size:\s*44px/)
  })

  it('preserves job ownership while hiding diagnostic links by default', () => {
    render(
      <TicketDetailScreen
        ticket={ticket({
          jobs: [
            job(),
            job({
              id: 'job-2',
              title: 'Diagnose front brake pulsation',
              kind: 'diagnostic',
              requiredSkillTier: 3,
              assignedTechId: 'tech-1',
              assignedTech: {
                id: 'tech-1',
                fullName: 'Angel Rivera',
                role: 'tech',
                skillTier: 3,
              },
              sessionId: 'session-1',
              workStatus: 'in_progress',
              approvalState: 'approved',
            }),
          ],
        })}
      />,
    )

    const jobs = screen.getAllByRole('listitem')
    expect(jobs).toHaveLength(2)
    expect(within(jobs[0]).getByRole('heading', { name: 'Diagnose brake vibration' })).toBeInTheDocument()
    expect(within(jobs[0]).getByText('Diagnostic · A-tech')).toBeInTheDocument()
    expect(within(jobs[0]).getByText('Open — no technician assigned')).toBeInTheDocument()
    expect(within(jobs[0]).queryByRole('link', { name: 'Open diagnosis' })).toBeNull()

    expect(within(jobs[1]).getByRole('heading', { name: 'Diagnose front brake pulsation' })).toBeInTheDocument()
    expect(within(jobs[1]).getByText('Diagnostic · A-tech')).toBeInTheDocument()
    expect(within(jobs[1]).getByText('Assigned · Angel Rivera')).toBeInTheDocument()
    expect(within(jobs[1]).queryByRole('link', { name: 'Open diagnosis' })).toBeNull()
  })

  it('labels every persisted work and approval state without collapsing them', () => {
    const states = [
      ['open', 'pending_quote', 'Work · Open', 'Approval · Quote not built'],
      ['in_progress', 'quote_ready', 'Work · In progress', 'Approval · Quote ready'],
      ['blocked', 'sent', 'Work · Blocked', 'Approval · Sent'],
      ['done', 'approved', 'Work · Done', 'Approval · Approved'],
      ['canceled', 'declined', 'Work · Canceled', 'Approval · Declined'],
    ] as const

    render(
      <TicketDetailScreen
        ticket={ticket({
          jobs: states.map(([workStatus, approvalState], index) =>
            job({
              id: `job-${index + 1}`,
              title: `Job ${index + 1}`,
              workStatus,
              approvalState,
            }),
          ),
        })}
      />,
    )

    const jobs = screen.getAllByRole('listitem')
    states.forEach(([, , workLabel, approvalLabel], index) => {
      expect(within(jobs[index]).getByText(workLabel)).toBeInTheDocument()
      expect(within(jobs[index]).getByText(approvalLabel)).toBeInTheDocument()
    })
  })

  it('links only the assigned actor with complete identity to eligible simple work and history', () => {
    render(<TicketDetailScreen currentProfileId="tech-1" ticket={ticket({
      jobs: [
        job({ id: 'repair-open', title: 'Install lift kit', kind: 'repair', assignedTechId: 'tech-1', workStatus: 'open' }),
        job({ id: 'maintenance-done', title: 'Rotate tires', kind: 'maintenance', assignedTechId: 'tech-1', workStatus: 'done' }),
        job({ id: 'other-work', title: 'Other tech work', kind: 'repair', assignedTechId: 'tech-2', workStatus: 'in_progress' }),
      ],
    })} />)
    expect(screen.getByRole('link', { name: 'Open work' })).toHaveAttribute('href', '/tickets/ticket-1/jobs/repair-open/work')
    expect(screen.getByRole('link', { name: 'View work history' })).toHaveAttribute('href', '/tickets/ticket-1/jobs/maintenance-done/work')
    expect(screen.getByText('Other tech work').closest('li')).not.toHaveTextContent('Continue work')
  })

  it('performs assigned approved work in place and folds confirmed completion into the ledger', async () => {
    const user = userEvent.setup()
    render(<TicketDetailScreen
      role="tech"
      skillTier={2}
      currentProfileId="tech-1"
      currentProfileName="Toni Tech"
      ticket={ticket({ jobs: [job({
        id: 'repair-open',
        title: 'Install lift kit',
        kind: 'repair',
        requiredSkillTier: 2,
        assignedTechId: 'tech-1',
        approvalState: 'approved',
      })] })}
    />)

    expect(screen.queryByRole('link', { name: 'Open work' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Start work' }))
    expect(screen.getByRole('region', { name: 'Inline work workspace' })).toBeInTheDocument()
    expect(screen.getByText('Steering wheel shakes under braking from highway speed.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Publish found concern' }))
    expect(screen.getByRole('heading', { name: 'Found: steering clunk' })).toBeInTheDocument()
    expect(screen.getByText('2 lines')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Publish work state' }))
    expect(screen.getByText('Work · Done')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Start|Continue) work$/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Close work' }))
    expect(screen.queryByRole('region', { name: 'Inline work workspace' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Install lift kit' }).closest('li')).toHaveFocus()
  })

  it('exposes no dead simple-work link when customer or vehicle identity is incomplete', () => {
    render(<TicketDetailScreen currentProfileId="tech-1" ticket={ticket({
      vehicle: null,
      jobs: [job({ title: 'Install lift kit', kind: 'repair', assignedTechId: 'tech-1' })],
    })} />)
    expect(screen.queryByRole('link', { name: 'Open work' })).toBeNull()
  })

  it('exposes no active-work link on a closed ticket while preserving done history', () => {
    render(<TicketDetailScreen currentProfileId="tech-1" ticket={ticket({
      status: 'closed',
      jobs: [
        job({ id: 'stale-open', title: 'Stale open work', kind: 'repair', assignedTechId: 'tech-1', workStatus: 'open' }),
        job({ id: 'closed-history', title: 'Completed work', kind: 'repair', assignedTechId: 'tech-1', workStatus: 'done' }),
      ],
    })} />)
    expect(screen.getByText('Stale open work').closest('li')).not.toHaveTextContent('Open work')
    expect(screen.getByRole('link', { name: 'View work history' })).toHaveAttribute('href', '/tickets/ticket-1/jobs/closed-history/work')
  })

  it('assigns an open job inside its ledger row and reconciles only returned truth', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async () => Response.json({
      assignment: {
        ticketId: 'ticket-1',
        jobId: 'repair-open',
        workStatus: 'open',
        state: 'team',
        assignedTechName: 'Angel Rivera',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(<TicketDetailScreen
      role="advisor"
      currentProfileId="advisor-1"
      currentProfileName="Avery Advisor"
      team={[{ id: 'tech-1', name: 'Angel Rivera', skillTier: 2, isCurrentUser: false }]}
      ticket={ticket({
        jobs: [
          job({ id: 'repair-open', title: 'Install lift kit', kind: 'repair', requiredSkillTier: 2 }),
          job({ id: 'other-open', title: 'Replace wipers', kind: 'maintenance', requiredSkillTier: 1 }),
        ],
      })}
    />)

    const target = screen.getByRole('heading', { name: 'Install lift kit' }).closest('li')!
    const untouched = screen.getByRole('heading', { name: 'Replace wipers' }).closest('li')!
    await user.click(within(target).getByRole('button', { name: 'Assign work' }))
    await user.click(within(target).getByRole('button', { name: /Angel Rivera.*B-tech/i }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tickets/ticket-1/jobs/repair-open/assignment',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'reassign', assignedTechId: 'tech-1' }),
      }),
    )
    expect(within(target).getByText('Assigned · Angel Rivera')).toBeInTheDocument()
    expect(within(untouched).getByText('Open — no technician assigned')).toBeInTheDocument()
    expect(within(target).queryByRole('button', { name: 'Assign work' })).toBeNull()
    expect(target).toHaveFocus()
  })

  it('lets an eligible technician claim in one tap without exposing the shop roster', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async () => Response.json({
      assignment: {
        ticketId: 'ticket-1',
        jobId: 'repair-open',
        workStatus: 'open',
        state: 'mine',
        assignedTechName: 'Toni Tech',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(<TicketDetailScreen
      role="tech"
      skillTier={2}
      currentProfileId="tech-1"
      currentProfileName="Toni Tech"
      team={[{ id: 'other-tech', name: 'Not visible', skillTier: 3, isCurrentUser: false }]}
      ticket={ticket({ jobs: [job({ id: 'repair-open', title: 'Install lift kit', kind: 'repair', requiredSkillTier: 2, approvalState: 'approved' })] })}
    />)

    await user.click(screen.getByRole('button', { name: 'Claim work' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tickets/ticket-1/jobs/repair-open/assignment',
      expect.objectContaining({ body: JSON.stringify({ action: 'claim' }) }),
    )
    expect(screen.getByText('Assigned · Toni Tech')).toBeInTheDocument()
    expect(screen.queryByText('Not visible')).toBeNull()
  })

  it('requires an explicit compact confirmation before a below-tier handoff', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async () => Response.json({
      assignment: {
        ticketId: 'ticket-1',
        jobId: 'repair-open',
        workStatus: 'open',
        state: 'team',
        assignedTechName: 'Casey Climber',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(<TicketDetailScreen
      role="owner"
      currentProfileId="owner-1"
      currentProfileName="Olivia Owner"
      team={[{ id: 'tech-1', name: 'Casey Climber', skillTier: 2, isCurrentUser: false }]}
      ticket={ticket({ jobs: [job({ id: 'repair-open', kind: 'repair', requiredSkillTier: 3 })] })}
    />)

    await user.click(screen.getByRole('button', { name: 'Assign work' }))
    await user.click(screen.getByRole('button', { name: /Casey Climber.*B-tech/i }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText(/requires an A-tech/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Assign anyway' }))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tickets/ticket-1/jobs/repair-open/assignment',
      expect.objectContaining({
        body: JSON.stringify({
          action: 'reassign',
          assignedTechId: 'tech-1',
          confirmBelowTier: true,
        }),
      }),
    )
  })

  it('keeps the row mounted and shows only the safe winner after a claim race', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: 'assignment_conflict',
      currentAssignee: { fullName: 'Morgan Master' },
    }, { status: 409 })))

    render(<TicketDetailScreen
      role="tech"
      skillTier={3}
      currentProfileId="tech-1"
      currentProfileName="Toni Tech"
      ticket={ticket({ jobs: [job({ id: 'repair-open', title: 'Install lift kit', kind: 'repair', requiredSkillTier: 2, approvalState: 'approved' })] })}
    />)

    await user.click(screen.getByRole('button', { name: 'Claim work' }))

    expect(screen.getByRole('heading', { name: 'Install lift kit' })).toBeInTheDocument()
    expect(screen.getByText('Assigned · Morgan Master')).toBeInTheDocument()
    expect(screen.getByText('Morgan Master claimed it first. The repair order is current.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Claim work' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Install lift kit' }).closest('li')).toHaveFocus()
  })
})
