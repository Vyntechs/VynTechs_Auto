import { describe, expect, it } from 'vitest'
import { formatAttentionClock } from '@/lib/shop-os/attention-clock'

const NOW = Date.parse('2026-08-02T18:00:00.000Z')

describe('formatAttentionClock', () => {
  it.each([
    ['2026-08-02T18:00:00.000Z', 'Quiet now', 'normal'],
    ['2026-08-02T17:59:01.000Z', 'Quiet now', 'normal'],
    ['2026-08-02T17:18:00.000Z', 'Quiet 42m', 'normal'],
    ['2026-08-02T11:00:00.000Z', 'Quiet 7h', 'normal'],
    ['2026-07-30T18:00:00.000Z', 'Quiet 3d', 'stale'],
  ] as const)('formats %s as %s', (attentionAt, label, tier) => {
    expect(formatAttentionClock(attentionAt, NOW)).toEqual({ label, tier })
  })

  it('turns stale at exactly 24 hours', () => {
    expect(formatAttentionClock('2026-08-01T18:00:00.000Z', NOW)).toEqual({
      label: 'Quiet 1d',
      tier: 'stale',
    })
  })

  it('clamps future clock skew to now', () => {
    expect(formatAttentionClock('2026-08-02T18:05:00.000Z', NOW)).toEqual({
      label: 'Quiet now',
      tier: 'normal',
    })
  })

  it('refuses an invalid timestamp', () => {
    expect(formatAttentionClock('not-a-time', NOW)).toBeNull()
  })
})
