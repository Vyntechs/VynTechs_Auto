import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePart, isFallbackKey } from '@/components/diagram-kit/registry'

// The real seeded scene must resolve with NO component kind unmapped (fallback
// is the deliberate safety net for UNSEEN values, never silent for seeded ones).
describe('registry covers scene-data.json', () => {
  const raw = readFileSync(
    path.resolve(__dirname, '../../../.design-shots/scene-data.json'),
    'utf8',
  )
  // Collect every component-kind value; exclude scenario kinds (operation/fault).
  const kinds = Array.from(raw.matchAll(/"kind"\s*:\s*"([a-z-]+)"/g))
    .map((m) => m[1])
    .filter((k) => !['operation', 'fault'].includes(k))

  it('every component kind in the scene resolves to a real (non-fallback) symbol', () => {
    expect(kinds.length).toBeGreaterThan(0)
    for (const k of kinds) {
      expect(typeof resolvePart(k as never)).toBe('function')
      expect(isFallbackKey(k as never)).toBe(false)
    }
  })
})
