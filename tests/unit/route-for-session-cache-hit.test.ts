import { describe, it, expect } from 'vitest'
import { routeForSession } from '@/lib/session-routing'
import type { TreeState } from '@/lib/ai/tree-engine'

// Helpers to build minimal session objects with the fields routeForSession needs.
// Uses the real TreeState shape: { nodes, currentNodeId, message, ...optional }.

const emptyTree: TreeState = {
  nodes: [],
  currentNodeId: '',
  message: '',
}

const activeTree: TreeState = {
  nodes: [{ id: 'n1', label: 'Check fuel pressure', status: 'active' }],
  currentNodeId: 'n1',
  message: 'Check fuel rail pressure.',
}

function makeSession(overrides: {
  status?: 'open' | 'closed' | 'declined' | 'deferred'
  treeState?: TreeState
  cacheHitSymptomId?: string | null
  cacheHitPlatformId?: string | null
}) {
  return {
    id: 'session-test-1',
    status: overrides.status ?? 'open',
    treeState: overrides.treeState ?? activeTree,
    cacheHitSymptomId: overrides.cacheHitSymptomId ?? null,
    cacheHitPlatformId: overrides.cacheHitPlatformId ?? null,
  }
}

describe('routeForSession — cached-overview branch', () => {
  it('returns cached-overview when cacheHitSymptomId is set', () => {
    const session = makeSession({
      cacheHitSymptomId: 'symptom-uuid-1',
      cacheHitPlatformId: 'platform-uuid-1',
      treeState: activeTree,
    })
    expect(routeForSession(session)).toEqual({ kind: 'cached-overview' })
  })

  it('returns cached-overview when cacheHitSymptomId is set even with empty treeState (beats tree-generating)', () => {
    const session = makeSession({
      cacheHitSymptomId: 'symptom-uuid-2',
      treeState: emptyTree,
    })
    // Must be cached-overview, NOT tree-generating
    expect(routeForSession(session)).toEqual({ kind: 'cached-overview' })
  })

  it('closed session still returns closed-summary (closed-session check is first)', () => {
    const session = makeSession({
      status: 'closed',
      cacheHitSymptomId: 'symptom-uuid-3',
    })
    expect(routeForSession(session)).toEqual({ kind: 'closed-summary' })
  })

  it('normal AI session with no cacheHitSymptomId and active tree returns active-session', () => {
    const session = makeSession({
      cacheHitSymptomId: null,
      treeState: activeTree,
    })
    expect(routeForSession(session)).toEqual({ kind: 'active-session' })
  })

  it('normal AI session with no cacheHitSymptomId and empty tree returns tree-generating', () => {
    const session = makeSession({
      cacheHitSymptomId: null,
      treeState: emptyTree,
    })
    expect(routeForSession(session)).toEqual({ kind: 'tree-generating' })
  })
})
