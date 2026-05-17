import { describe, it, expect } from 'vitest'
import { attributeCitationsToCurrentNode } from '@/lib/knowledge/attribute-citations'
import type { TreeState } from '@/lib/ai/tree-engine'

function makeTree(overrides?: Partial<TreeState>): TreeState {
  return {
    nodes: [
      { id: 'n_root', label: 'root', status: 'resolved' },
      { id: 'n_step_3', label: 'check connector', status: 'active' },
      { id: 'n_step_4', label: 'smoke test', status: 'pending' },
    ],
    currentNodeId: 'n_step_3',
    message: 'check it',
    ...overrides,
  }
}

describe('attributeCitationsToCurrentNode', () => {
  it('writes citation IDs onto the current node on the first turn', () => {
    // prev tree has no citations anywhere → carry-forward is a no-op.
    const out = attributeCitationsToCurrentNode(makeTree(), makeTree(), ['k-1', 'k-2'])
    const node = out.nodes.find((n) => n.id === 'n_step_3')
    expect(node?.citationItemIds).toEqual(['k-1', 'k-2'])
  })

  it('leaves other nodes untouched on the first turn', () => {
    const out = attributeCitationsToCurrentNode(makeTree(), makeTree(), ['k-1'])
    const root = out.nodes.find((n) => n.id === 'n_root')
    const step4 = out.nodes.find((n) => n.id === 'n_step_4')
    expect(root?.citationItemIds).toBeUndefined()
    expect(step4?.citationItemIds).toBeUndefined()
  })

  it('carries prior citations forward onto matching nodes in the new tree', () => {
    const prev = makeTree({
      nodes: [
        { id: 'n_step_3', label: 'check', status: 'resolved', citationItemIds: ['k-a', 'k-b'] },
      ],
      currentNodeId: 'n_step_3',
    })
    // AI returns a NEW tree object (no citationItemIds on its nodes) with
    // the same node id present.
    const next = makeTree({
      nodes: [{ id: 'n_step_3', label: 'check', status: 'resolved' }],
      currentNodeId: 'n_step_3',
    })
    const out = attributeCitationsToCurrentNode(prev, next, [])
    expect(out.nodes[0].citationItemIds).toEqual(['k-a', 'k-b'])
  })

  it('carries prior citations + appends new ones in the same turn', () => {
    const prev = makeTree({
      nodes: [
        { id: 'n_step_3', label: 'check', status: 'active', citationItemIds: ['k-a', 'k-b'] },
      ],
      currentNodeId: 'n_step_3',
    })
    const next = makeTree({
      nodes: [{ id: 'n_step_3', label: 'check', status: 'active' }],
      currentNodeId: 'n_step_3',
    })
    const out = attributeCitationsToCurrentNode(prev, next, ['k-c'])
    expect(out.nodes[0].citationItemIds).toEqual(['k-a', 'k-b', 'k-c'])
  })

  it('dedupes — already-present IDs (from prior or new) are skipped', () => {
    const prev = makeTree({
      nodes: [
        { id: 'n_step_3', label: 'check', status: 'active', citationItemIds: ['k-a', 'k-b'] },
      ],
      currentNodeId: 'n_step_3',
    })
    const next = makeTree({
      nodes: [{ id: 'n_step_3', label: 'check', status: 'active' }],
      currentNodeId: 'n_step_3',
    })
    const out = attributeCitationsToCurrentNode(prev, next, ['k-b', 'k-c', 'k-a'])
    // k-b and k-a already present from prior turn → skipped. k-c new → appended.
    expect(out.nodes[0].citationItemIds).toEqual(['k-a', 'k-b', 'k-c'])
  })

  it('preserves first-citation order across turns, not most-recent order', () => {
    const prev = makeTree({
      nodes: [
        { id: 'n_step_3', label: 'check', status: 'active', citationItemIds: ['k-a', 'k-b'] },
      ],
      currentNodeId: 'n_step_3',
    })
    const next = makeTree({
      nodes: [{ id: 'n_step_3', label: 'check', status: 'active' }],
      currentNodeId: 'n_step_3',
    })
    // Re-citing k-a does NOT move it to the end.
    const out = attributeCitationsToCurrentNode(prev, next, ['k-a'])
    expect(out.nodes[0].citationItemIds).toEqual(['k-a', 'k-b'])
  })

  it('returns input tree unchanged when no prior citations and no new IDs', () => {
    const prev = makeTree()
    const next = makeTree()
    const out = attributeCitationsToCurrentNode(prev, next, [])
    expect(out).toBe(next)
  })

  it('still carries prior citations forward even when this turn cites nothing', () => {
    const prev = makeTree({
      nodes: [
        { id: 'n_step_3', label: 'check', status: 'active', citationItemIds: ['k-a'] },
      ],
      currentNodeId: 'n_step_3',
    })
    const next = makeTree({
      nodes: [{ id: 'n_step_3', label: 'check', status: 'active' }],
      currentNodeId: 'n_step_3',
    })
    const out = attributeCitationsToCurrentNode(prev, next, [])
    expect(out.nodes[0].citationItemIds).toEqual(['k-a'])
  })

  it('does not write citations to a non-existent current node', () => {
    const prev = makeTree()
    const next = makeTree({ currentNodeId: 'n_does_not_exist' })
    const out = attributeCitationsToCurrentNode(prev, next, ['k-1'])
    // No node matches currentNodeId → new IDs are silently dropped (no place to put them).
    expect(out.nodes.every((n) => !n.citationItemIds?.includes('k-1'))).toBe(true)
  })

  it('does not mutate the input next tree (immutability)', () => {
    const prev = makeTree()
    const next = makeTree()
    const beforeNodes = next.nodes
    attributeCitationsToCurrentNode(prev, next, ['k-1'])
    expect(next.nodes).toBe(beforeNodes)
    expect(next.nodes.find((n) => n.id === 'n_step_3')?.citationItemIds).toBeUndefined()
  })

  it('drops orphan prior citations when the node no longer exists in next tree', () => {
    const prev = makeTree({
      nodes: [
        { id: 'n_old', label: 'old', status: 'pruned', citationItemIds: ['k-orphan'] },
      ],
      currentNodeId: 'n_step_3',
    })
    const next = makeTree() // doesn't have n_old
    const out = attributeCitationsToCurrentNode(prev, next, [])
    // k-orphan has nowhere to go — silently dropped.
    expect(out.nodes.some((n) => n.citationItemIds?.includes('k-orphan'))).toBe(false)
  })
})
