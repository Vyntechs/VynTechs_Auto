import { describe, it, expect } from 'vitest'
import { routeForSession } from '@/lib/session-routing'
import type { TreeState } from '@/lib/ai/tree-engine'
import type { Session } from '@/lib/db/schema'

const activeTree: TreeState = {
  nodes: [{ id: 'n1', label: 'step 1', status: 'active' }],
  currentNodeId: 'n1',
  message: '',
}

function buildSession(
  overrides: Partial<Pick<Session, 'id' | 'status' | 'treeState' | 'cacheHitPlatformId' | 'cacheHitSymptomId'>>,
): Pick<Session, 'id' | 'status' | 'treeState' | 'cacheHitPlatformId' | 'cacheHitSymptomId'> {
  return {
    id: 'sess-1',
    status: 'open',
    treeState: activeTree,
    cacheHitPlatformId: null,
    cacheHitSymptomId: null,
    ...overrides,
  }
}

describe('routeForSession', () => {
  it('returns tree-generating while the tree is still booting (no nodes yet)', () => {
    expect(
      routeForSession(
        buildSession({
          treeState: { nodes: [], currentNodeId: '', message: '' },
        }),
      ),
    ).toEqual({ kind: 'tree-generating' })
  })

  it('redirects to /decline when the gate blocks the proposed action', () => {
    expect(
      routeForSession(
        buildSession({
          treeState: {
            ...activeTree,
            gateDecision: {
              allow: false,
              riskClass: 'destructive',
              threshold: 0.85,
              confidence: 0.7,
              rationale: 'too risky without more data',
            },
          },
        }),
      ),
    ).toEqual({ kind: 'redirect', to: '/sessions/sess-1/decline' })
  })

  it('renders active-session when tree is done — view shows AI repair plan, tech closes manually after verifying', () => {
    // Was: redirect to /outcome. Removed 2026-05-07 (Brandon's 2009 Ram
    // 1500 P0171/P0174 case) because the redirect skipped the AI's safety
    // message, recommended-repair description, and expected-signal block
    // entirely — the active-session view is where that content renders,
    // and the redirect fired in the same page-render that the AI's done
    // response landed. Tech now reads the diagnosis on /sessions/[id],
    // does the repair + verification, then clicks Close case manually.
    expect(
      routeForSession(
        buildSession({
          status: 'open',
          treeState: {
            ...activeTree,
            done: true,
            rootCauseSummary: 'Torn BPV diaphragm — 2013 F-150 3.5 EcoBoost',
          },
        }),
      ),
    ).toEqual({ kind: 'active-session' })
  })

  it('renders a read-only closed-summary view when session is closed (no more active-session UI loop)', () => {
    expect(
      routeForSession(
        buildSession({
          status: 'closed',
          treeState: { ...activeTree, done: true },
        }),
      ),
    ).toEqual({ kind: 'closed-summary' })
  })

  it('renders closed-summary even if treeState.done is false (closed is closed)', () => {
    expect(
      routeForSession(
        buildSession({
          status: 'closed',
          treeState: { ...activeTree, done: false },
        }),
      ),
    ).toEqual({ kind: 'closed-summary' })
  })

  it('does NOT redirect to outcome when session is declined', () => {
    expect(
      routeForSession(
        buildSession({
          status: 'declined',
          treeState: { ...activeTree, done: true },
        }),
      ),
    ).toEqual({ kind: 'active-session' })
  })

  it('does NOT redirect to outcome when session is deferred', () => {
    expect(
      routeForSession(
        buildSession({
          status: 'deferred',
          treeState: { ...activeTree, done: true },
        }),
      ),
    ).toEqual({ kind: 'active-session' })
  })

  it('renders active-session when the tree has nodes and is in progress', () => {
    expect(routeForSession(buildSession({}))).toEqual({ kind: 'active-session' })
  })

  it('gate-blocked still redirects to /decline even when tree is done', () => {
    expect(
      routeForSession(
        buildSession({
          treeState: {
            ...activeTree,
            done: true,
            gateDecision: {
              allow: false,
              riskClass: 'destructive',
              threshold: 0.85,
              confidence: 0.7,
              rationale: 'gate fires first',
            },
          },
        }),
      ),
    ).toEqual({ kind: 'redirect', to: '/sessions/sess-1/decline' })
  })
})
