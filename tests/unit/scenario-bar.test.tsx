import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ScenarioBar } from '@/components/topology/scenario-bar'
import type { TopologyScenario } from '@/lib/diagnostics/load-system-topology'

const scn = (overrides: Partial<TopologyScenario>): TopologyScenario => ({
  id: overrides.slug ?? 'x',
  slug: 'x',
  label: 'x',
  sub: 'x',
  kind: 'operation',
  keyPosition: null,
  engineState: null,
  loadLevel: null,
  isDefault: false,
  displayOrder: 0,
  pinStates: {},
  pinReadings: {},
  ...overrides,
})

const eightScenarios: TopologyScenario[] = [
  scn({ slug: 'key-off', label: 'Key off', kind: 'operation', keyPosition: 'off' }),
  scn({
    slug: 'key-on',
    label: 'Key on',
    kind: 'operation',
    keyPosition: 'on',
    engineState: 'off',
  }),
  scn({
    slug: 'idle',
    label: 'Idle',
    kind: 'operation',
    keyPosition: 'on',
    engineState: 'running',
    loadLevel: 'idle',
    isDefault: true,
  }),
  scn({
    slug: 'light-load',
    label: 'Light',
    kind: 'operation',
    keyPosition: 'on',
    engineState: 'running',
    loadLevel: 'light',
  }),
  scn({
    slug: 'medium-load',
    label: 'Medium',
    kind: 'operation',
    keyPosition: 'on',
    engineState: 'running',
    loadLevel: 'medium',
  }),
  scn({
    slug: 'heavy-load',
    label: 'Heavy',
    kind: 'operation',
    keyPosition: 'on',
    engineState: 'running',
    loadLevel: 'heavy',
  }),
  scn({ slug: 'fault-high', label: 'Pegged high pressure', kind: 'fault' }),
  scn({ slug: 'fault-low', label: 'No pressure', kind: 'fault' }),
]

describe('ScenarioBar', () => {
  it('renders ignition + engine + load + fault buttons when active scenario is Idle', () => {
    render(
      <ScenarioBar
        scenarios={eightScenarios}
        activeSlug="idle"
        onScenarioChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /ignition on/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /engine running/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^idle$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pegged high pressure/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /no pressure/i })).toBeInTheDocument()
  })

  it('hides engine state when ignition is off', () => {
    render(
      <ScenarioBar
        scenarios={eightScenarios}
        activeSlug="key-off"
        onScenarioChange={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /engine running/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^idle$/i })).toBeNull()
  })

  it('hides load level when engine is off', () => {
    render(
      <ScenarioBar
        scenarios={eightScenarios}
        activeSlug="key-on"
        onScenarioChange={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /^heavy$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^idle$/i })).toBeNull()
  })

  it('emits key-on when ignition toggled to On from key-off (no engine choice yet)', () => {
    const onScenarioChange = vi.fn()
    render(
      <ScenarioBar
        scenarios={eightScenarios}
        activeSlug="key-off"
        onScenarioChange={onScenarioChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /ignition on/i }))
    expect(onScenarioChange).toHaveBeenCalledWith('key-on')
  })

  it('emits heavy-load when load is set to Heavy with engine running', () => {
    const onScenarioChange = vi.fn()
    render(
      <ScenarioBar
        scenarios={eightScenarios}
        activeSlug="idle"
        onScenarioChange={onScenarioChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^heavy$/i }))
    expect(onScenarioChange).toHaveBeenCalledWith('heavy-load')
  })

  it('emits idle when load is set to Idle from Heavy', () => {
    const onScenarioChange = vi.fn()
    render(
      <ScenarioBar
        scenarios={eightScenarios}
        activeSlug="heavy-load"
        onScenarioChange={onScenarioChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^idle$/i }))
    expect(onScenarioChange).toHaveBeenCalledWith('idle')
  })

  it('fault click overrides operation state', () => {
    const onScenarioChange = vi.fn()
    render(
      <ScenarioBar
        scenarios={eightScenarios}
        activeSlug="idle"
        onScenarioChange={onScenarioChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /pegged high pressure/i }))
    expect(onScenarioChange).toHaveBeenCalledWith('fault-high')
  })

  it('shows fault buttons even when ignition is off', () => {
    render(
      <ScenarioBar
        scenarios={eightScenarios}
        activeSlug="key-off"
        onScenarioChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /pegged high pressure/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /no pressure/i })).toBeInTheDocument()
  })

  it('marks the active operation control with aria-pressed=true', () => {
    render(
      <ScenarioBar
        scenarios={eightScenarios}
        activeSlug="heavy-load"
        onScenarioChange={vi.fn()}
      />,
    )
    expect(
      screen.getByRole('button', { name: /^heavy$/i }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('button', { name: /^medium$/i }),
    ).toHaveAttribute('aria-pressed', 'false')
  })

  it('marks the active fault button with aria-pressed=true and clears operation aria-pressed', () => {
    render(
      <ScenarioBar
        scenarios={eightScenarios}
        activeSlug="fault-high"
        onScenarioChange={vi.fn()}
      />,
    )
    expect(
      screen.getByRole('button', { name: /pegged high pressure/i }),
    ).toHaveAttribute('aria-pressed', 'true')
    // Idle button still rendered (compound state derives to idle defaults on fault)
    // but should NOT have aria-pressed=true
    const idleBtn = screen.queryByRole('button', { name: /^idle$/i })
    if (idleBtn) {
      expect(idleBtn).toHaveAttribute('aria-pressed', 'false')
    }
  })

  it('clicking ignition Off from idle emits key-off (operation control overrides fault)', () => {
    const onScenarioChange = vi.fn()
    render(
      <ScenarioBar
        scenarios={eightScenarios}
        activeSlug="fault-high"
        onScenarioChange={onScenarioChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /ignition off/i }))
    expect(onScenarioChange).toHaveBeenCalledWith('key-off')
  })
})
