import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

import { CounterPlanQuote, type CounterPlanQuoteProps } from '@/components/screens/counter-plan-quote'
import type { PlanStep } from '@/components/vt/desktop/plan-tree'

const baseSteps: PlanStep[] = [
  { n: '01', title: 'Pull DTCs and freeze frame', detail: 'Confirm fault path.', meta: '5 min · low risk', conf: 96 },
  { n: '02', title: 'Inspect K-CAN bus', detail: 'Visual.', meta: '20 min · low risk', conf: 88 },
  { n: '03', title: 'Verify charging', detail: 'Voltage drop test.', meta: '25 min · low risk', conf: 84 },
  { n: '04', title: 'Test FRM3', detail: 'Common N55 failure.', meta: '30 min · medium risk', conf: 73 },
  { n: '05', title: 'K-CAN splice', detail: 'Curator-gated.', meta: '45 min · destructive · gating', conf: 62 },
]

const baseProps: CounterPlanQuoteProps = {
  draftId: 'draft-abc',
  customerLabel: 'Sandoval · 2014 BMW 335i',
  steps: baseSteps,
  gate: 70,
  craftedInSeconds: 1.4,
  quote: {
    lines: [
      { title: 'Diagnostic — DTC pull, K-CAN, charging, FRM3', sub: 'Steps 01–04. Gets us to a defensible diagnosis.', hours: '1.5', laborUSD: '$165' },
      { title: 'Repair — K-CAN splice + verification', sub: 'Step 05. Conditional. Curator-gated.', hours: '0.75', laborUSD: '$82' },
      { title: 'Parts — likely needed', sub: 'FRM3 module if isolated · K-CAN splice kit ~$28.', hours: '—', laborUSD: '—' },
    ],
    totalHours: '2.25 hr',
    totalUSD: '$247',
    rateNote: 'Shop rate $110/hr · parts not included in total',
  },
  writerNoteDefault: 'Mr. Sandoval prefers reman. Authorized diagnostic only.',
}

describe('CounterPlanQuote', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ workOrderId: 'wo-2026-04-247' }),
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    mockPush.mockReset()
  })

  it('renders the screen heading', () => {
    render(<CounterPlanQuote {...baseProps} />)
    expect(screen.getByRole('heading', { name: /here's what we'll do/i })).toBeInTheDocument()
  })

  it('renders the plan tree with all five steps', () => {
    render(<CounterPlanQuote {...baseProps} />)
    expect(screen.getByText('Pull DTCs and freeze frame')).toBeInTheDocument()
    expect(screen.getByText('Test FRM3')).toBeInTheDocument()
    expect(screen.getByText('K-CAN splice')).toBeInTheDocument()
  })

  it('renders the quote table with line items and totals', () => {
    render(<CounterPlanQuote {...baseProps} />)
    expect(screen.getByText(/diagnostic — dtc pull/i)).toBeInTheDocument()
    expect(screen.getByText('1.5')).toBeInTheDocument()
    expect(screen.getByText('$165')).toBeInTheDocument()
    expect(screen.getByText('2.25 hr')).toBeInTheDocument()
    expect(screen.getByText('$247')).toBeInTheDocument()
    expect(screen.getByText(/shop rate \$110\/hr/i)).toBeInTheDocument()
  })

  it('renders the writer note textarea with the supplied default', () => {
    render(<CounterPlanQuote {...baseProps} />)
    const textarea = screen.getByLabelText(/writer's note/i) as HTMLTextAreaElement
    expect(textarea.value).toContain('Mr. Sandoval prefers reman')
  })

  it('shows the AI-drafted-in eyebrow with crafted-in time', () => {
    render(<CounterPlanQuote {...baseProps} />)
    expect(screen.getByText(/pre-bay plan · drafted in 1\.4 s/i)).toBeInTheDocument()
  })

  it('POSTs to /api/intake/authorize and navigates to confirm on Authorize click', async () => {
    render(<CounterPlanQuote {...baseProps} />)
    const authorize = screen.getAllByRole('button', { name: /authorize & queue/i })[0]
    fireEvent.click(authorize)

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/intake/authorize',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'content-type': 'application/json' }),
          body: expect.stringContaining('draft-abc'),
        }),
      )
    })

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/intake/confirmed/wo-2026-04-247')
    })
  })

  it('removes a quote line when its remove button is clicked', () => {
    render(<CounterPlanQuote {...baseProps} />)
    const removeButtons = screen.getAllByRole('button', { name: /remove/i })
    expect(removeButtons.length).toBeGreaterThan(0)
    fireEvent.click(removeButtons[0])
    expect(screen.queryByText(/diagnostic — dtc pull/i)).not.toBeInTheDocument()
  })
})
