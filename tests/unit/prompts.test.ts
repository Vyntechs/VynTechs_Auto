import { describe, it, expect } from 'vitest'
import { TREE_ENGINE_SYSTEM } from '@/lib/ai/prompts'

describe('TREE_ENGINE_SYSTEM prompt', () => {
  it('requires part-location guidance so unskilled techs know where to look', () => {
    // 2026-05-04 dogfood: a working master diagnostician asked "Where is the BPV?"
    // because the AI's check-bpv step had no location hint. An unskilled tech
    // would be completely blocked. The prompt must keep requiring location
    // guidance for any action that names a specific component.
    expect(TREE_ENGINE_SYSTEM).toMatch(
      /may not know where|location hint|where (the|a) (named )?(part|component) lives|brief location/i,
    )
  })
})
