import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

import {
  CounterWorkOrderConfirm,
  type CounterWorkOrderConfirmProps,
} from '@/components/screens/counter-work-order-confirm'

const baseProps: CounterWorkOrderConfirmProps = {
  workOrderId: 'WO-2026-04-247',
  customerLabel: 'Sandoval · 2014 BMW 335i',
  vehicle: { line: '2014 BMW 335i', sub: 'N55 · 110,400 mi' },
  customer: { line: 'Sandoval, R.', sub: '(303) 555-0142' },
  estimate: { line: '2.25 hr · $247', sub: 'labor · parts TBD' },
  techAssigned: { line: 'Marcus T.', sub: 'Bay 3 · queued #2' },
  steps: [
    { n: '01', title: 'Pull DTCs and freeze frame', auth: true },
    { n: '02', title: 'Inspect K-CAN bus integrity', auth: true },
    { n: '03', title: 'Verify charging system', auth: true },
    { n: '04', title: 'Test FRM3 module', auth: true },
    { n: '05', title: 'K-CAN splice repair (curator-gated)', auth: false },
  ],
  authSummary: '5 steps · authorized for 01–04',
  customerMessage: {
    sentAt: 'Sent · 11:27 am',
    body: 'Hi Robert — your 335i is checked in. Diagnostic estimate is 1.5 hrs / $165.',
  },
}

describe('CounterWorkOrderConfirm', () => {
  beforeEach(() => {
    mockPush.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders the work order eyebrow and title', () => {
    render(<CounterWorkOrderConfirm {...baseProps} />)
    expect(screen.getByText(/work order · wo-2026-04-247/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /queued for the next bay tech/i })).toBeInTheDocument()
  })

  it('renders the engraved plate with all four cells', () => {
    render(<CounterWorkOrderConfirm {...baseProps} />)
    expect(screen.getByText('Vehicle')).toBeInTheDocument()
    expect(screen.getByText('2014 BMW 335i')).toBeInTheDocument()
    expect(screen.getByText('Customer')).toBeInTheDocument()
    expect(screen.getByText('Sandoval, R.')).toBeInTheDocument()
    expect(screen.getByText('Estimate')).toBeInTheDocument()
    expect(screen.getByText('2.25 hr · $247')).toBeInTheDocument()
    expect(screen.getByText('Tech assigned')).toBeInTheDocument()
    expect(screen.getByText('Marcus T.')).toBeInTheDocument()
  })

  it('renders the read-only plan recap with auth summary', () => {
    render(<CounterWorkOrderConfirm {...baseProps} />)
    expect(screen.getByRole('heading', { name: /what the bay tech will do/i })).toBeInTheDocument()
    expect(screen.getByText(/5 steps · authorized for 01–04/i)).toBeInTheDocument()
  })

  it('passes steps to a read-only plan tree (no confidence bars, shows authorized/pending)', () => {
    const { container } = render(<CounterWorkOrderConfirm {...baseProps} />)
    expect(container.querySelectorAll('.vt-plan-step__conf-bar').length).toBe(0)
    expect(screen.getAllByText('Authorized').length).toBe(4)
    expect(screen.getByText('Pending call')).toBeInTheDocument()
  })

  it('renders the customer message preview', () => {
    render(<CounterWorkOrderConfirm {...baseProps} />)
    expect(screen.getByText(/sent · 11:27 am/i)).toBeInTheDocument()
    expect(screen.getByText(/hi robert — your 335i is checked in/i)).toBeInTheDocument()
  })

  it('navigates to /intake when "New intake" is clicked', () => {
    render(<CounterWorkOrderConfirm {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /new intake/i }))
    expect(mockPush).toHaveBeenCalledWith('/intake')
  })

  it('disables Print receipt with a "wires up in Counter 04" title (no-op stub)', () => {
    render(<CounterWorkOrderConfirm {...baseProps} />)
    const btn = screen.getByRole('button', { name: /print receipt/i }) as HTMLButtonElement
    expect(btn).toBeDisabled()
    expect(btn.title).toMatch(/counter 04/i)
  })
})
