import { describe, expect, it } from 'vitest'
import { verifySourceSpans } from '@/lib/knowledge/verify-source-spans'

describe('verifySourceSpans', () => {
  it('keeps a field with a span that is a verbatim substring of the paste', () => {
    const r = verifySourceSpans(
      'P0420 cylinder 1 misfire on 2018 F-150',
      { title: 'cylinder 1 misfire' },
      { title: 'cylinder 1 misfire' },
    )
    expect(r.stripped).toEqual([])
    expect(r.unverified).toEqual([])
    expect(r.draft.title).toBe('cylinder 1 misfire')
    expect(r.sourceSpans.title).toBe('cylinder 1 misfire')
  })

  it('keeps a field whose span matches case-insensitively', () => {
    const r = verifySourceSpans(
      'TSB 18-2218 — Customer concern: harsh shift',
      { title: 'TSB 18-2218' },
      { title: 'tsb 18-2218' },
    )
    expect(r.draft.title).toBe('TSB 18-2218')
    expect(r.unverified).toEqual([])
    expect(r.stripped).toEqual([])
  })

  it('keeps a field whose span matches after whitespace collapse', () => {
    const r = verifySourceSpans(
      'cylinder 1   misfire',
      { title: 'misfire' },
      { title: 'cylinder 1 misfire' },
    )
    expect(r.stripped).toEqual([])
  })

  it('keeps a field whose span uses an em-dash where paste has a hyphen', () => {
    const r = verifySourceSpans(
      '2018 F-150 EcoBoost engine',
      { title: 'F-150 EcoBoost' },
      { title: 'F—150 EcoBoost' },
    )
    expect(r.stripped).toEqual([])
    expect(r.sourceSpans.title).toBe('F—150 EcoBoost')
  })

  it('keeps a field whose span uses smart quotes where paste has straight', () => {
    const r = verifySourceSpans(
      `tech's note about misfire`,
      { title: 'misfire note' },
      { title: `tech’s note` },
    )
    expect(r.stripped).toEqual([])
  })

  it('strips a field whose span is NOT in the paste', () => {
    const r = verifySourceSpans(
      'P0420 misfire',
      { title: 'rough idle' },
      { title: 'engine runs rough at idle' },
    )
    expect(r.stripped).toEqual(['title'])
    expect(r.draft.title).toBeUndefined()
    expect(r.sourceSpans.title).toBeUndefined()
  })

  it('marks a populated field as unverified when its span is missing', () => {
    const r = verifySourceSpans(
      'P0420 misfire',
      { title: 'a title' },
      {},
    )
    expect(r.unverified).toEqual(['title'])
    expect(r.draft.title).toBe('a title')
  })

  it('treats an empty-string span the same as a missing span', () => {
    const r = verifySourceSpans(
      'P0420 misfire',
      { title: 'a title' },
      { title: '' },
    )
    expect(r.unverified).toEqual(['title'])
    expect(r.draft.title).toBe('a title')
  })

  it('handles a mixed payload: verified + stripped + unverified', () => {
    const r = verifySourceSpans(
      'P0420 cylinder 1 misfire on 2018 F-150',
      {
        title: 'cylinder 1 misfire',
        body: 'engine runs rough',
        dtcList: ['P0420'],
      },
      {
        title: 'cylinder 1 misfire',
        body: 'rough running engine',
        // dtcList missing → unverified
      },
    )
    expect(r.stripped).toEqual(['body'])
    expect(r.unverified).toEqual(['dtcList'])
    expect(r.draft.title).toBe('cylinder 1 misfire')
    expect(r.draft.body).toBeUndefined()
    expect(r.draft.dtcList).toEqual(['P0420'])
    expect(r.sourceSpans).toEqual({ title: 'cylinder 1 misfire' })
  })

  it('verifies dtcList array with a whole-list receipt', () => {
    const r = verifySourceSpans(
      'codes: P0420 and P0430',
      { dtcList: ['P0420', 'P0430'] },
      { dtcList: 'P0420 and P0430' },
    )
    expect(r.stripped).toEqual([])
    expect(r.unverified).toEqual([])
  })

  it('walks structuredData fields and verifies them by key', () => {
    const r = verifySourceSpans(
      'Complaint: harsh 1-2 shift. Cause: TCM software needs reflash.',
      {
        type: 'cause_fix',
        structuredData: {
          complaint: 'harsh 1-2 shift',
          cause: 'rough idle module', // fake
        },
      },
      {
        complaint: 'harsh 1-2 shift',
        cause: 'rough idle module reset', // span not in paste
      },
    )
    expect(r.stripped).toEqual(['cause'])
    expect(r.draft.structuredData?.complaint).toBe('harsh 1-2 shift')
    expect(r.draft.structuredData?.cause).toBeUndefined()
  })

  it('returns empty arrays when both draft and spans are empty', () => {
    const r = verifySourceSpans('anything', {}, {})
    expect(r.stripped).toEqual([])
    expect(r.unverified).toEqual([])
    expect(r.sourceSpans).toEqual({})
  })

  it('strips ALL populated fields when the paste is empty', () => {
    const r = verifySourceSpans(
      '',
      { title: 'Hallucinated title', body: 'Hallucinated body' },
      { title: 'Hallucinated title', body: 'Hallucinated body' },
    )
    expect(r.stripped.sort()).toEqual(['body', 'title'])
    expect(r.draft.title).toBeUndefined()
    expect(r.draft.body).toBeUndefined()
  })

  it('silently ignores orphan source-span keys (no matching draft field)', () => {
    const r = verifySourceSpans(
      'P0420 misfire',
      { title: 'P0420' },
      { title: 'P0420', nonexistent: 'P0420' },
    )
    expect(r.stripped).toEqual([])
    expect(r.unverified).toEqual([])
    expect(r.sourceSpans).toEqual({ title: 'P0420' })
  })

  it('does NOT verify vehicleScopes — passes them through untouched', () => {
    const r = verifySourceSpans(
      'P0420 misfire',
      {
        title: 'P0420',
        vehicleScopes: [
          { yearStart: 2018, yearEnd: 2020, make: 'Ford', model: 'F-150' },
        ],
      },
      { title: 'P0420' },
    )
    expect(r.stripped).toEqual([])
    expect(r.unverified).toEqual([])
    expect(r.draft.vehicleScopes).toEqual([
      { yearStart: 2018, yearEnd: 2020, make: 'Ford', model: 'F-150' },
    ])
  })
})
