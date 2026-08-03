import { describe, expect, it } from 'vitest'
import {
  TICKET_CORRECTION_DRAFT_MAX_AGE_MS,
  TICKET_CORRECTION_DRAFT_MAX_BYTES,
  encodeTicketCorrectionDraft,
  parseTicketCorrectionDraft,
  prepareTicketCorrectionRequest,
  ticketCorrectionDraftKey,
  type TicketCorrectionDraft,
  type TicketCorrectionTarget,
} from '@/lib/shop-os/ticket-correction-draft'

const ACTOR_ID = '00000000-0000-4000-8000-000000000101'
const OTHER_ACTOR_ID = '00000000-0000-4000-8000-000000000102'
const TICKET_ID = '00000000-0000-4000-8000-000000000201'
const OTHER_TICKET_ID = '00000000-0000-4000-8000-000000000202'
const JOB_ID = '00000000-0000-4000-8000-000000000301'
const OTHER_JOB_ID = '00000000-0000-4000-8000-000000000302'
const REQUEST_KEY_1 = '00000000-0000-4000-8000-000000000401'
const REQUEST_KEY_2 = '00000000-0000-4000-8000-000000000402'
const VERSION_ID = '00000000-0000-4000-8000-000000000501'
const NOW = Date.UTC(2026, 7, 3, 15)

function concernDraft(overrides: Partial<TicketCorrectionDraft> = {}): TicketCorrectionDraft {
  return {
    version: 1,
    actorId: ACTOR_ID,
    ticketId: TICKET_ID,
    target: { kind: 'concern' },
    fields: { kind: 'concern', concern: 'Rattle over rough roads' },
    pending: null,
    savedAt: NOW,
    ...overrides,
  }
}

describe('ticket correction draft recovery', () => {
  it.each<[TicketCorrectionTarget, TicketCorrectionDraft['fields']]>([
    [{ kind: 'identity' }, {
      kind: 'identity', mode: 'new', vehicleId: null,
      name: 'Jamie Reed', phone: '214-555-0101', email: '',
      year: '2021', make: 'Ram', model: '2500', engine: '6.7L',
      vin: '', mileage: '88300', plate: '',
    }],
    [{ kind: 'concern' }, { kind: 'concern', concern: 'Rattle over rough roads' }],
    [{ kind: 'job', jobId: JOB_ID }, {
      kind: 'job', title: 'Inspect front suspension', jobKind: 'diagnostic',
      customerSuppliedPartsNote: '', remove: false,
    }],
  ])('round-trips only the exact actor, ticket, and target scope', (target, fields) => {
    const candidate = concernDraft({ target, fields })
    const encoded = encodeTicketCorrectionDraft(candidate, NOW)

    expect(new TextEncoder().encode(encoded).byteLength).toBeLessThanOrEqual(
      TICKET_CORRECTION_DRAFT_MAX_BYTES,
    )
    expect(parseTicketCorrectionDraft(encoded, {
      actorId: ACTOR_ID,
      ticketId: TICKET_ID,
      target,
      now: NOW,
    })).toEqual(candidate)
    expect(ticketCorrectionDraftKey(ACTOR_ID, TICKET_ID, target)).toContain(
      target.kind === 'job' ? `job:${JOB_ID}` : target.kind,
    )
  })

  it('rejects a draft from another actor, ticket, or exact job target', () => {
    const target = { kind: 'job', jobId: JOB_ID } as const
    const raw = encodeTicketCorrectionDraft(concernDraft({
      target,
      fields: {
        kind: 'job', title: 'Inspect front suspension', jobKind: 'diagnostic',
        customerSuppliedPartsNote: '', remove: false,
      },
    }), NOW)

    expect(parseTicketCorrectionDraft(raw, {
      actorId: OTHER_ACTOR_ID, ticketId: TICKET_ID, target, now: NOW,
    })).toBeNull()
    expect(parseTicketCorrectionDraft(raw, {
      actorId: ACTOR_ID, ticketId: OTHER_TICKET_ID, target, now: NOW,
    })).toBeNull()
    expect(parseTicketCorrectionDraft(raw, {
      actorId: ACTOR_ID, ticketId: TICKET_ID,
      target: { kind: 'job', jobId: OTHER_JOB_ID }, now: NOW,
    })).toBeNull()
  })

  it('rejects expired, future, corrupt, oversized, and extra-key storage', () => {
    const expiredAt = NOW - TICKET_CORRECTION_DRAFT_MAX_AGE_MS - 1
    const expired = encodeTicketCorrectionDraft(concernDraft({ savedAt: expiredAt }), expiredAt)
    const future = JSON.stringify({ ...concernDraft(), savedAt: NOW + 60_001 })
    const extra = JSON.stringify({ ...concernDraft(), rawServerResponse: 'must not restore' })
    const scope = {
      actorId: ACTOR_ID, ticketId: TICKET_ID,
      target: { kind: 'concern' } as const, now: NOW,
    }

    expect(parseTicketCorrectionDraft(expired, scope)).toBeNull()
    expect(parseTicketCorrectionDraft(future, scope)).toBeNull()
    expect(parseTicketCorrectionDraft('{', scope)).toBeNull()
    expect(parseTicketCorrectionDraft('x'.repeat(TICKET_CORRECTION_DRAFT_MAX_BYTES + 1), scope))
      .toBeNull()
    expect(parseTicketCorrectionDraft(extra, scope)).toBeNull()
  })

  it('reuses the byte-equivalent pending body, signature, and request key after ambiguity', () => {
    const intent = {
      action: 'concern' as const,
      expectedTicketUpdatedAt: '2026-08-03T14:00:00.000Z',
      expectedActiveVersionId: VERSION_ID,
      concern: 'Rattle over rough roads',
    }
    const first = prepareTicketCorrectionRequest(intent, null, () => REQUEST_KEY_1)
    const retry = prepareTicketCorrectionRequest(intent, first, () => REQUEST_KEY_2)

    expect(first.body).toBe(
      `{"action":"concern","concern":"Rattle over rough roads","expectedActiveVersionId":"${VERSION_ID}","expectedTicketUpdatedAt":"2026-08-03T14:00:00.000Z","requestKey":"${REQUEST_KEY_1}"}`,
    )
    expect(retry).toEqual(first)
    expect(retry.signature).toMatch(/^v1:[0-9a-f]{16}$/)
  })

  it('rotates the key when refreshed expectations change the normalized intent', () => {
    const first = prepareTicketCorrectionRequest({
      action: 'concern',
      expectedTicketUpdatedAt: '2026-08-03T14:00:00.000Z',
      expectedActiveVersionId: VERSION_ID,
      concern: 'Rattle over rough roads',
    }, null, () => REQUEST_KEY_1)
    const refreshed = prepareTicketCorrectionRequest({
      action: 'concern',
      expectedTicketUpdatedAt: '2026-08-03T14:05:00.000Z',
      expectedActiveVersionId: null,
      concern: 'Rattle over rough roads',
    }, first, () => REQUEST_KEY_2)

    expect(refreshed.requestKey).toBe(REQUEST_KEY_2)
    expect(refreshed.signature).not.toBe(first.signature)
    expect(refreshed.body).not.toBe(first.body)
    expect(JSON.parse(refreshed.body)).toMatchObject({
      requestKey: REQUEST_KEY_2,
      expectedTicketUpdatedAt: '2026-08-03T14:05:00.000Z',
      expectedActiveVersionId: null,
    })
  })
})
