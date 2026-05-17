import { describe, it, expect } from 'vitest'
import { extractCitedItems, REF_MARKER_RE } from '@/lib/knowledge/citations'
import type { MatchedKnowledgeItem } from '@/lib/knowledge/retrieval'

const items: MatchedKnowledgeItem[] = [
  {
    id: 'a-1',
    shopId: 's',
    type: 'cause_fix',
    title: 'A',
    body: null,
    structuredData: null,
    dtcList: [],
    systemCodes: [],
    symptoms: [],
    fireCount: 0,
    score: 0,
  },
  {
    id: 'b-2',
    shopId: 's',
    type: 'pinout',
    title: 'B',
    body: null,
    structuredData: null,
    dtcList: [],
    systemCodes: [],
    symptoms: [],
    fireCount: 0,
    score: 0,
  },
]

describe('citations', () => {
  it('extracts cited ids from text', () => {
    const cited = extractCitedItems('See [ref:a-1] and also [ref:b-2].', items)
    expect(cited.map((c) => c.id)).toEqual(['a-1', 'b-2'])
  })

  it('ignores cite markers that do not match any consulted item', () => {
    const cited = extractCitedItems('See [ref:ghost-id] for details.', items)
    expect(cited).toEqual([])
  })

  it('deduplicates repeated cites', () => {
    const cited = extractCitedItems('[ref:a-1] [ref:a-1] [ref:a-1]', items)
    expect(cited.map((c) => c.id)).toEqual(['a-1'])
  })

  it('REF_MARKER_RE matches uuid-shaped ids', () => {
    const re = new RegExp(REF_MARKER_RE.source, 'g')
    const matches = [...'[ref:11111111-2222-3333-4444-555555555555]'.matchAll(re)]
    expect(matches[0]?.[1]).toBe('11111111-2222-3333-4444-555555555555')
  })

  it('returns empty when text has no markers', () => {
    expect(extractCitedItems('plain message without markers', items)).toEqual([])
  })

  it('returns empty when consulted list is empty', () => {
    expect(extractCitedItems('[ref:a-1]', [])).toEqual([])
  })
})
