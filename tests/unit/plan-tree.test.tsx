import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PlanTree, type PlanStep } from '@/components/vt/desktop/plan-tree'

const baseSteps: PlanStep[] = [
  { n: '01', title: 'Pull DTCs and freeze frame', detail: 'Confirm fault path.', meta: '5 min · low risk', conf: 96 },
  { n: '02', title: 'Inspect K-CAN bus', detail: 'Visual on first pass.', meta: '20 min · low risk', conf: 88 },
  { n: '03', title: 'Verify charging system', detail: 'Voltage drop test.', meta: '25 min · low risk', conf: 73 },
  { n: '04', title: 'Test FRM3 module', detail: 'Common N55 failure.', meta: '30 min · medium risk', conf: 62 },
]

describe('PlanTree', () => {
  it('renders each step with number, title, detail, and meta in editable mode', () => {
    render(<PlanTree steps={baseSteps} variant="editable" />)
    expect(screen.getByText('01')).toBeInTheDocument()
    expect(screen.getByText('Pull DTCs and freeze frame')).toBeInTheDocument()
    expect(screen.getByText('Confirm fault path.')).toBeInTheDocument()
    expect(screen.getByText('5 min · low risk')).toBeInTheDocument()
    expect(screen.getByText('Inspect K-CAN bus')).toBeInTheDocument()
  })

  it('shows the confidence number and a confidence bar for each step in editable mode', () => {
    const { container } = render(<PlanTree steps={baseSteps} variant="editable" />)
    expect(screen.getByText('96')).toBeInTheDocument()
    expect(screen.getByText('88')).toBeInTheDocument()
    expect(screen.getByText('73')).toBeInTheDocument()
    expect(screen.getByText('62')).toBeInTheDocument()
    const bars = container.querySelectorAll('.vt-plan-step__conf-bar')
    expect(bars.length).toBe(4)
  })

  it('renders the head with title and gate meta in editable mode', () => {
    render(<PlanTree steps={baseSteps} variant="editable" gate={70} title="Confidence-weighted plan" />)
    expect(screen.getByRole('heading', { name: /confidence-weighted plan/i })).toBeInTheDocument()
    expect(screen.getByText(/gate · ≥ 70 to proceed/i)).toBeInTheDocument()
  })

  it('applies the gating modifier class to steps below the gate', () => {
    const { container } = render(<PlanTree steps={baseSteps} variant="editable" gate={70} />)
    // step 04 (conf 62) is below gate → vt-plan-step--gating
    const gating = container.querySelectorAll('.vt-plan-step--gating')
    expect(gating.length).toBe(1)
  })

  it('applies the low modifier class to steps within 10 points above the gate', () => {
    const { container } = render(<PlanTree steps={baseSteps} variant="editable" gate={70} />)
    // step 03 (conf 73) is gate ≤ x < gate+10 → vt-plan-step--low
    const low = container.querySelectorAll('.vt-plan-step--low')
    expect(low.length).toBe(1)
  })

  it('omits the head and confidence bars in readonly mode and shows authorized/pending status', () => {
    const readonlySteps: PlanStep[] = [
      { n: '01', title: 'Pull DTCs', auth: true },
      { n: '02', title: 'Inspect K-CAN', auth: true },
      { n: '05', title: 'K-CAN splice repair', auth: false },
    ]
    const { container } = render(<PlanTree steps={readonlySteps} variant="readonly" />)
    expect(container.querySelector('.vt-plan-tree__head')).toBeNull()
    expect(container.querySelectorAll('.vt-plan-step__conf-bar').length).toBe(0)
    const authorized = screen.getAllByText(/authorized/i)
    const pending = screen.getAllByText(/pending call/i)
    expect(authorized.length).toBe(2)
    expect(pending.length).toBe(1)
  })

  it('uses the default gate of 70 when no gate prop is passed', () => {
    const { container } = render(<PlanTree steps={baseSteps} variant="editable" />)
    expect(screen.getByText(/gate · ≥ 70 to proceed/i)).toBeInTheDocument()
    // step 04 (conf 62) below default gate → gating
    expect(container.querySelectorAll('.vt-plan-step--gating').length).toBe(1)
  })
})
