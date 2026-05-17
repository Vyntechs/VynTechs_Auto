import type { TreeNode, TreeState } from '@/lib/ai/tree-engine'

/**
 * Persist cited knowledge-item IDs onto the tree across an advance turn.
 *
 * Two concerns folded into one call:
 *
 * 1. **Carry forward** — the AI's tree response doesn't include the
 *    Vyntechs-only `citationItemIds` field, so each turn we lose the
 *    history attached to prior steps unless we copy it forward. For
 *    every node in `nextTree` whose id matches a node in `prevTree`,
 *    we copy the prior `citationItemIds` onto it.
 *
 * 2. **Attribute new citations** — append this turn's `citedItemIds`
 *    onto the `currentNodeId` node, deduping against whatever was just
 *    carried forward. Order is first-citation order (Set-merge against
 *    the existing list).
 *
 * Returns a new TreeState (immutable). If both `prevTree` has no
 * citations AND `citedItemIds` is empty, returns the input `nextTree`
 * unchanged.
 */
export function attributeCitationsToCurrentNode(
  prevTree: TreeState,
  nextTree: TreeState,
  citedItemIds: string[],
): TreeState {
  const priorByNodeId = new Map<string, string[]>()
  for (const node of prevTree.nodes) {
    const ids = node.citationItemIds
    if (ids && ids.length > 0) priorByNodeId.set(node.id, ids)
  }

  const hasPrior = priorByNodeId.size > 0
  const hasNew = citedItemIds.length > 0
  if (!hasPrior && !hasNew) return nextTree

  const currentNodeExists = nextTree.nodes.some((n) => n.id === nextTree.currentNodeId)

  return {
    ...nextTree,
    nodes: nextTree.nodes.map((node) => {
      const carryOver = priorByNodeId.get(node.id) ?? []
      const isCurrentNode = hasNew && currentNodeExists && node.id === nextTree.currentNodeId
      const incoming = isCurrentNode ? [...carryOver, ...citedItemIds] : carryOver
      if (incoming.length === 0) return node
      return mergeNodeCitations(node, incoming)
    }),
  }
}

function mergeNodeCitations(node: TreeNode, newIds: string[]): TreeNode {
  const existing = node.citationItemIds ?? []
  const seen = new Set(existing)
  const merged: string[] = [...existing]
  for (const id of newIds) {
    if (seen.has(id)) continue
    seen.add(id)
    merged.push(id)
  }
  // Avoid a no-op rewrite that would needlessly create a new object.
  if (merged.length === existing.length) return node
  return { ...node, citationItemIds: merged }
}
