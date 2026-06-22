import { describe, it, expect } from 'vitest'
import { formatRuledOut } from '@/lib/diagnostics/diagram/progress-line'
import type { ForkResolution } from '@/lib/diagnostics/diagram/step-sequence'

describe('formatRuledOut', () => {
  it('returns the curator reasoning for a matched words branch', () => {
    const r: ForkResolution = {
      kind: 'words',
      nextActionText: 'Proceed to WIF status PID check.',
      reasoning: 'Fuel present eliminates empty tank. Continue diagnosis downstream.',
    }
    expect(formatRuledOut(r)).toBe(
      'Fuel present eliminates empty tank. Continue diagnosis downstream.',
    )
  })

  it('returns the reasoning for a matched route branch too', () => {
    const r: ForkResolution = {
      kind: 'route',
      toTestActionId: 'abc',
      nextActionText: 'Escalate to IMV PWM waveform.',
      reasoning: 'High IMV duty cycle at idle is a command-level fault.',
    }
    expect(formatRuledOut(r)).toBe('High IMV duty cycle at idle is a command-level fault.')
  })

  it('suppresses (null) when no branch matched the verdict', () => {
    expect(formatRuledOut({ kind: 'none' })).toBeNull()
  })

  it('suppresses when the curator did not author the reasoning half', () => {
    expect(
      formatRuledOut({ kind: 'words', nextActionText: 'Proceed.', reasoning: null }),
    ).toBeNull()
  })

  it('suppresses blank/whitespace reasoning rather than rendering an empty line', () => {
    expect(
      formatRuledOut({ kind: 'words', nextActionText: 'Proceed.', reasoning: '   ' }),
    ).toBeNull()
    expect(formatRuledOut({ kind: 'words', nextActionText: 'Proceed.', reasoning: '' })).toBeNull()
  })

  it('trims surrounding whitespace from authored reasoning', () => {
    expect(
      formatRuledOut({
        kind: 'words',
        nextActionText: 'Proceed.',
        reasoning: '  Normal idle FRP PID narrows the fault to a load-triggered event.  ',
      }),
    ).toBe('Normal idle FRP PID narrows the fault to a load-triggered event.')
  })
})
