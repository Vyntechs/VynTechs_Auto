import { describe, expect, it } from 'vitest'
import {
  QUOTE_EDITOR_DRAFT_MAX_AGE_MS,
  QUOTE_EDITOR_DRAFT_MAX_BYTES,
  encodeQuoteEditorDraft,
  parseQuoteEditorDraft,
  quoteEditorDraftKey,
  type QuoteEditorDraft,
} from '@/lib/shop-os/quote-editor-draft'

const ACTOR_ID = '00000000-0000-4000-8000-000000000101'
const OTHER_ACTOR_ID = '00000000-0000-4000-8000-000000000102'
const TICKET_ID = '00000000-0000-4000-8000-000000000201'
const OTHER_TICKET_ID = '00000000-0000-4000-8000-000000000202'
const JOB_ID = '00000000-0000-4000-8000-000000000301'
const LINE_ID = '00000000-0000-4000-8000-000000000401'
const CLIENT_KEY = '00000000-0000-4000-8000-000000000501'
const NOW = Date.UTC(2026, 6, 21, 12)

function draft(overrides: Partial<QuoteEditorDraft> = {}): QuoteEditorDraft {
  return {
    version: 1,
    actorId: ACTOR_ID,
    ticketId: TICKET_ID,
    jobId: JOB_ID,
    mode: 'create',
    kind: 'part',
    lineId: null,
    values: {
      description: 'Premium pad set',
      quantity: '1',
      hours: '1',
      price: '129.95',
      taxable: true,
      partNumber: 'PAD-1',
      brand: 'ACME',
      fitment: 'Front axle',
    },
    hoursChanged: false,
    clientKey: CLIENT_KEY,
    savedAt: NOW,
    ...overrides,
  }
}

const scope = { actorId: ACTOR_ID, ticketId: TICKET_ID, now: NOW }

describe('quote editor draft codec', () => {
  it('round-trips one normalized, actor-and-ticket-scoped create draft', () => {
    const original = draft({
      actorId: ACTOR_ID.toUpperCase(),
      ticketId: TICKET_ID.toUpperCase(),
      jobId: JOB_ID.toUpperCase(),
      clientKey: CLIENT_KEY.toUpperCase(),
    })

    const encoded = encodeQuoteEditorDraft(original, NOW)

    expect(new TextEncoder().encode(encoded).byteLength).toBeLessThanOrEqual(
      QUOTE_EDITOR_DRAFT_MAX_BYTES,
    )
    expect(parseQuoteEditorDraft(encoded, scope)).toEqual(draft())
    expect(quoteEditorDraftKey(ACTOR_ID.toUpperCase(), TICKET_ID.toUpperCase())).toBe(
      `vyntechs:quote-editor-draft:v1:${ACTOR_ID}:${TICKET_ID}`,
    )
  })

  it('accepts an edit draft only with an exact line and no create key', () => {
    const edit = draft({
      mode: 'edit',
      kind: 'labor',
      lineId: LINE_ID,
      clientKey: null,
      hoursChanged: true,
    })

    expect(parseQuoteEditorDraft(encodeQuoteEditorDraft(edit, NOW), scope)).toEqual(edit)
    expect(() => encodeQuoteEditorDraft({ ...edit, lineId: null }, NOW)).toThrow()
    expect(() => encodeQuoteEditorDraft({ ...edit, clientKey: CLIENT_KEY }, NOW)).toThrow()
  })

  it('rejects drafts outside the exact actor or ticket scope', () => {
    const encoded = encodeQuoteEditorDraft(draft(), NOW)

    expect(parseQuoteEditorDraft(encoded, { ...scope, actorId: OTHER_ACTOR_ID })).toBeNull()
    expect(parseQuoteEditorDraft(encoded, { ...scope, ticketId: OTHER_TICKET_ID })).toBeNull()
  })

  it('rejects expired, future, malformed, and oversized payloads', () => {
    const expired = encodeQuoteEditorDraft(
      draft({ savedAt: NOW - QUOTE_EDITOR_DRAFT_MAX_AGE_MS - 1 }),
      NOW - QUOTE_EDITOR_DRAFT_MAX_AGE_MS - 1,
    )
    const future = JSON.stringify({ ...draft(), savedAt: NOW + 60_001 })

    expect(parseQuoteEditorDraft(expired, scope)).toBeNull()
    expect(parseQuoteEditorDraft(future, scope)).toBeNull()
    expect(parseQuoteEditorDraft('{', scope)).toBeNull()
    expect(parseQuoteEditorDraft('x'.repeat(QUOTE_EDITOR_DRAFT_MAX_BYTES + 1), scope)).toBeNull()
  })

  it('rejects extra keys, wrong types, invalid UUIDs, and inconsistent modes', () => {
    const candidates = [
      { ...draft(), secret: 'hidden' },
      { ...draft(), hoursChanged: 'false' },
      { ...draft(), actorId: 'not-a-uuid' },
      { ...draft(), kind: 'diagnostic' },
      { ...draft(), mode: 'create', lineId: LINE_ID },
      { ...draft(), mode: 'edit', lineId: LINE_ID, clientKey: CLIENT_KEY },
    ]

    for (const candidate of candidates) {
      expect(parseQuoteEditorDraft(JSON.stringify(candidate), scope)).toBeNull()
    }
  })

  it('enforces the editor field bounds before anything reaches storage', () => {
    const invalidValues = [
      { description: 'x'.repeat(501) },
      { quantity: 'x'.repeat(65) },
      { hours: 'x'.repeat(65) },
      { price: 'x'.repeat(65) },
      { partNumber: 'x'.repeat(201) },
      { brand: 'x'.repeat(201) },
      { fitment: 'x'.repeat(501) },
      { taxable: 'true' },
    ]

    for (const values of invalidValues) {
      expect(() => encodeQuoteEditorDraft(draft({
        values: { ...draft().values, ...values } as QuoteEditorDraft['values'],
      }), NOW)).toThrow()
    }
  })

  it('serializes only the bounded editor contract', () => {
    const encoded = encodeQuoteEditorDraft(draft(), NOW)

    expect(encoded).not.toMatch(/customer|vehicle|concern|total|cookie|password|token/i)
    expect(Object.keys(JSON.parse(encoded))).toEqual([
      'version', 'actorId', 'ticketId', 'jobId', 'mode', 'kind', 'lineId',
      'values', 'hoursChanged', 'clientKey', 'savedAt',
    ])
  })
})
