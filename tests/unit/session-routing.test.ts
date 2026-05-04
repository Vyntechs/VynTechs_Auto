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
  overrides: Partial<Pick<Session, 'id' | 'status' | 'treeState'>>,
): Pick<Session, 'id' | 'status' | 'treeState'> {
  return {
    id: 'sess-1',
    status: 'open',
    treeState: activeTree,
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

  it('redirects to /outcome when tree is done and session is still open — the dead-end fix from 2026-05-04 dogfood', () => {
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
    ).toEqual({ kind: 'redirect', to: '/sessions/sess-1/outcome' })
  })

  it('renders active-session when tree is done but session is already closed (avoids redirect loop)', () => {
    expect(
      routeForSession(
        buildSession({
          status: 'closed',
          treeState: { ...activeTree, done: true },
        }),
      ),
    ).toEqual({ kind: 'active-session' })
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

  it('gate redirect takes precedence over done redirect when both fire', () => {
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
