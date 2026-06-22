import { describe, it, expect } from 'vitest'
import { getTableColumns, getTableName } from 'drizzle-orm'
import { techOutcomes } from '@/lib/db/schema'

describe('techOutcomes schema registration', () => {
  it('maps to the tech_outcomes table', () => {
    expect(getTableName(techOutcomes)).toBe('tech_outcomes')
  })

  it('exposes every column the per-check log needs', () => {
    const cols = Object.keys(getTableColumns(techOutcomes))
    for (const c of [
      'id',
      'testActionId',
      'sessionId',
      'shopId',
      'techId',
      'measuredValue',
      'measuredUnit',
      'measuredObservation',
      'verdict',
      'recordedAt',
    ]) {
      expect(cols).toContain(c)
    }
  })
})
