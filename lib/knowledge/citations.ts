import type { MatchedKnowledgeItem } from '@/lib/knowledge/retrieval'

// Matches AI-inserted citation markers in the form [ref:item_id] where
// item_id is a UUID or any alphanumeric+hyphen identifier. Re-compile
// per call to keep the regex stateless across iterations.
export const REF_MARKER_RE = /\[ref:([A-Za-z0-9-]+)\]/g

export function extractCitedItems(
  message: string,
  consulted: MatchedKnowledgeItem[],
): MatchedKnowledgeItem[] {
  const byId = new Map(consulted.map((i) => [i.id, i]))
  const cited: MatchedKnowledgeItem[] = []
  const seen = new Set<string>()
  // Re-create the RegExp so iteration state is local.
  const re = new RegExp(REF_MARKER_RE.source, 'g')
  for (const match of message.matchAll(re)) {
    const id = match[1]
    if (seen.has(id)) continue
    seen.add(id)
    const item = byId.get(id)
    if (item) cited.push(item)
  }
  return cited
}
