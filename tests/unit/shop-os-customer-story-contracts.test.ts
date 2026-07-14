import { describe, expect, it } from 'vitest'

import {
  CUSTOMER_STORY_WAIVER,
  parsePersistedCustomerStory,
  parsePersistedCustomerStoryMeta,
  parseQuoteStorySnapshotMeta,
  customerStoryReviewTextSchema,
} from '@/lib/shop-os/customer-story-contracts'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const story = {
  whatYouToldUs: 'Battery warning appears while driving.',
  whatWeFound: 'Alternator output is below specification.',
  howWeKnow: [{ claim: 'Charging output measured 11.8 volts.', sourceEventIds: [uuid(1)], sourceArtifactIds: [] }],
  whatItMeansIfWaived: 'The diagnosed issue remains unresolved.',
  whatWeRecommend: 'Replace the alternator.',
}

const reviewedAudit = {
  reviewClientKey: uuid(4),
  reviewRequestFingerprint: 'b'.repeat(64),
  reviewedByProfileId: uuid(5),
  reviewedAt: '2026-07-11T12:01:00.000Z',
}

describe('customer story persisted contracts', () => {
  it('owns the exact neutral waiver used by every persisted story path', () => {
    expect(CUSTOMER_STORY_WAIVER).toBe(
      'If you choose not to proceed, the diagnosed issue remains unresolved.',
    )
  })

  it('normalizes review input and rejects invisible/control narratives', () => {
    expect(customerStoryReviewTextSchema.parse('  Visible finding.\r\n\u200b ')).toBe('Visible finding.')
    for (const value of ['', ' \n\t ', '\u200b\u200c\u2060', '\u0000\u0007']) {
      expect(customerStoryReviewTextSchema.safeParse(value).success).toBe(false)
    }
    expect(customerStoryReviewTextSchema.safeParse('x'.repeat(5_001)).success).toBe(false)
  })

  it('accepts only canonical bounded story fields and UUID proof IDs', () => {
    expect(parsePersistedCustomerStory(story)).toEqual(story)
    expect(parsePersistedCustomerStory({ ...story, whatWeFound: ' trailing ' })).toBeNull()
    expect(parsePersistedCustomerStory({ ...story, whatWeFound: '\u0000' })).toBeNull()
    expect(parsePersistedCustomerStory({
      ...story,
      howWeKnow: [{ ...story.howWeKnow[0], sourceEventIds: ['event-1'] }],
    })).toBeNull()
    expect(parsePersistedCustomerStory({
      ...story,
      howWeKnow: [{ ...story.howWeKnow[0], sourceEventIds: Array.from({ length: 6 }, (_, index) => uuid(index + 10)) }],
    })).toBeNull()
  })

  it('requires complete AI generation metadata and coherent review audit', () => {
    const pending = {
      source: 'ai' as const, sessionId: uuid(2), generatedAt: '2026-07-11T12:00:00.000Z',
      lastEditedByProfileId: uuid(3), lastEditedAt: '2026-07-11T12:00:00.000Z',
      generationClientKey: uuid(4), generationRequestFingerprint: 'a'.repeat(64),
      generatedByProfileId: uuid(3), storyRevision: 1, reviewStatus: 'pending' as const,
    }
    expect(parsePersistedCustomerStoryMeta(pending)).toEqual(pending)
    expect(parsePersistedCustomerStoryMeta({ ...pending, generationClientKey: undefined })).toBeNull()
    expect(parsePersistedCustomerStoryMeta({ ...pending, reviewStatus: 'reviewed' })).toBeNull()
    expect(parsePersistedCustomerStoryMeta({ ...pending, reviewStatus: 'reviewed', ...reviewedAudit }))
      .toEqual({ ...pending, reviewStatus: 'reviewed', ...reviewedAudit })
  })

  it('requires complete row-21 manual metadata; session binding exact when present, absent for sessionless findings', () => {
    const manual = {
      source: 'manual' as const, sessionId: uuid(2),
      lastEditedByProfileId: uuid(3), lastEditedAt: '2026-07-11T12:00:00.000Z',
      storyRevision: 1, reviewStatus: 'reviewed' as const, ...reviewedAudit,
    }
    expect(parsePersistedCustomerStoryMeta(manual)).toEqual(manual)
    // Sessionless manual findings (diagnostics add-on not on the shop —
    // Record-findings path) carry no session binding at all.
    const { sessionId: _omitted, ...sessionless } = manual
    expect(parsePersistedCustomerStoryMeta(sessionless)).toEqual(sessionless)
    for (const corrupt of [
      { ...manual, sessionId: 'not-a-uuid' },
      { ...manual, storyRevision: 0 },
      { ...manual, reviewClientKey: undefined },
    ]) expect(parsePersistedCustomerStoryMeta(corrupt)).toBeNull()
  })

  it('parses only the minimal immutable snapshot projection', () => {
    expect(parseQuoteStorySnapshotMeta({ source: 'ai', sessionId: uuid(2) }))
      .toEqual({ source: 'ai', sessionId: uuid(2) })
    expect(parseQuoteStorySnapshotMeta({ source: 'manual', sessionId: uuid(2) }))
      .toEqual({ source: 'manual', sessionId: uuid(2) })
    expect(parseQuoteStorySnapshotMeta({ source: 'template' })).toEqual({ source: 'template' })
    expect(parseQuoteStorySnapshotMeta({ source: 'ai', sessionId: uuid(2), extra: true })).toBeNull()
  })
})
