import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  Pill,
  Risk,
  VehicleStrip,
  Module,
  ConfidenceBlock,
  TreeRail,
  CaptureBar,
  AppHeader,
  DtcChip,
  HairlineProgress,
} from '@/components/vt'

describe('Pill', () => {
  it('applies kind class and renders children', () => {
    const { container } = render(<Pill kind="active">In progress</Pill>)
    const span = container.querySelector('.pill.active')
    expect(span).not.toBeNull()
    expect(span!.textContent).toContain('In progress')
  })
})

describe('Risk', () => {
  it('exposes risk level via aria-label', () => {
    render(<Risk level="medium" />)
    expect(screen.getByLabelText(/risk class: medium/i)).toBeInTheDocument()
  })

  it('renders the visible level word', () => {
    render(<Risk level="destructive" />)
    expect(screen.getByText(/Destructive/)).toBeInTheDocument()
  })
})

describe('VehicleStrip', () => {
  it('renders vehicle name, vin, and timer', () => {
    render(
      <VehicleStrip
        name="2018 Ford F-150 — 3.5L EcoBoost"
        vin="VIN · 1FT...12345"
        timer="14:32"
      />
    )
    expect(screen.getByText('2018 Ford F-150 — 3.5L EcoBoost')).toBeInTheDocument()
    expect(screen.getByText('VIN · 1FT...12345')).toBeInTheDocument()
    expect(screen.getByLabelText('Session elapsed: 14:32')).toHaveTextContent('14:32')
  })
})

describe('Module', () => {
  it('renders eyebrow label and optional number', () => {
    render(
      <Module num="04" label="Active step">
        <p>body</p>
      </Module>
    )
    expect(screen.getByText('04·')).toBeInTheDocument()
    expect(screen.getByText('Active step')).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })
})

describe('ConfidenceBlock', () => {
  it('renders one-decimal percent and meter role', () => {
    render(<ConfidenceBlock value={0.87} basis="47 corpus matches" />)
    const meter = screen.getByRole('meter')
    expect(meter).toHaveAttribute('aria-valuenow', '87')
    expect(meter.textContent).toContain('87.0')
    expect(screen.getByText(/47 corpus matches/)).toBeInTheDocument()
  })

  it('shows "Below gate" copy when blocked is true', () => {
    render(<ConfidenceBlock value={0.62} gate={0.9} blocked />)
    expect(screen.getByText(/Below gate · 90%/)).toBeInTheDocument()
  })
})

describe('TreeRail', () => {
  it('marks the active step with aria-current=step', () => {
    render(
      <TreeRail
        steps={[
          { id: 'a', label: 'Pull DTCs', status: 'done' },
          { id: 'b', label: 'Inspect cold-side CAC', status: 'active' },
          { id: 'c', label: 'Locate escape source', status: 'pending' },
        ]}
      />
    )
    expect(screen.getByText('Inspect cold-side CAC').closest('li')).toHaveAttribute(
      'aria-current',
      'step'
    )
  })

  it('numbers steps from 01', () => {
    render(<TreeRail steps={[{ label: 'first', status: 'active' }]} />)
    expect(screen.getByText('01')).toBeInTheDocument()
  })
})

describe('CaptureBar', () => {
  it('renders four labeled capture buttons', () => {
    render(<CaptureBar />)
    expect(screen.getByLabelText('Voice')).toBeInTheDocument()
    expect(screen.getByLabelText('Photo')).toBeInTheDocument()
    expect(screen.getByLabelText('Video')).toBeInTheDocument()
    expect(screen.getByLabelText('Scan')).toBeInTheDocument()
  })
})

describe('AppHeader', () => {
  it('renders title and meta', () => {
    render(<AppHeader title="My Jobs" meta={<span>Marcus · Bay 3</span>} />)
    expect(screen.getByText('My Jobs')).toBeInTheDocument()
    expect(screen.getByText('Marcus · Bay 3')).toBeInTheDocument()
  })
})

describe('DtcChip', () => {
  it('renders the code and applies dtc-chip class', () => {
    const { container } = render(<DtcChip>P0299</DtcChip>)
    const chip = container.querySelector('.dtc-chip')
    expect(chip).not.toBeNull()
    expect(chip!.textContent).toBe('P0299')
  })
})

describe('HairlineProgress', () => {
  it('exposes a progressbar role with a label', () => {
    render(<HairlineProgress />)
    expect(screen.getByRole('progressbar', { name: /loading/i })).toBeInTheDocument()
  })
})
