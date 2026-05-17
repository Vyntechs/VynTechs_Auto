import type { ClassifiedPasteResult } from '@/lib/knowledge/classify-paste'

export type VerifyResult = {
  draft: ClassifiedPasteResult['draft']
  sourceSpans: Record<string, string>
  stripped: string[]
  unverified: string[]
}

const TOP_LEVEL_VERIFIABLE = ['title', 'body', 'dtcList', 'systemCodes', 'symptoms'] as const

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[–—‐‑‒―]/g, '-')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function fieldHasContent(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return false
}

export function verifySourceSpans(
  paste: string,
  draft: ClassifiedPasteResult['draft'],
  sourceSpans: Record<string, string>,
): VerifyResult {
  const np = normalize(paste)
  const outDraft: ClassifiedPasteResult['draft'] = { ...draft }
  if (outDraft.structuredData) {
    outDraft.structuredData = { ...outDraft.structuredData }
  }
  const outSpans: Record<string, string> = {}
  const stripped: string[] = []
  const unverified: string[] = []

  type Loc = 'top' | 'structured'
  const fields: Array<{ loc: Loc; key: string }> = []
  for (const key of TOP_LEVEL_VERIFIABLE) {
    fields.push({ loc: 'top', key })
  }
  if (outDraft.structuredData) {
    for (const key of Object.keys(outDraft.structuredData)) {
      fields.push({ loc: 'structured', key })
    }
  }

  const getVal = (loc: Loc, key: string): unknown =>
    loc === 'top'
      ? (outDraft as Record<string, unknown>)[key]
      : (outDraft.structuredData as Record<string, unknown> | undefined)?.[key]

  const clearVal = (loc: Loc, key: string): void => {
    if (loc === 'top') {
      ;(outDraft as Record<string, unknown>)[key] = undefined
    } else if (outDraft.structuredData) {
      ;(outDraft.structuredData as Record<string, unknown>)[key] = undefined
    }
  }

  for (const { loc, key } of fields) {
    if (!fieldHasContent(getVal(loc, key))) continue
    const span = sourceSpans[key]
    if (!span || span.trim().length === 0) {
      unverified.push(key)
      continue
    }
    if (np.includes(normalize(span))) {
      outSpans[key] = span
    } else {
      clearVal(loc, key)
      stripped.push(key)
    }
  }

  return { draft: outDraft, sourceSpans: outSpans, stripped, unverified }
}
