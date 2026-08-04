import { describe, expect, it } from 'vitest'
import {
  encodeTicketIntakeDraft,
  parseTicketIntakeDraft,
  ticketIntakeDraftKey,
  type TicketIntakeDraft,
} from '@/lib/intake/ticket-intake-draft'

const actorId = 'A0B1C2D3-E4F5-4A67-8B9C-0D1E2F3A4B5C'
const otherActorId = '00000000-0000-4000-8000-000000000002'
const now = new Date('2026-08-03T17:00:00.000Z')

function draft(surface: TicketIntakeDraft['surface']): TicketIntakeDraft {
  return {
    actorId,
    surface,
    form: {
      existingVehicleId: '00000000-0000-4000-8000-000000000003',
      name: 'Robin Chen',
      phone: '555 0199',
      email: 'robin@example.test',
      year: '2018',
      make: 'Honda',
      model: 'Civic',
      engine: '2.0L',
      vin: '19XFC2F59JE000001',
      mileage: '84201',
      plate: 'TXR 84',
      concern: 'Intermittent no-start after fuel stop',
      assignedTechId: '00000000-0000-4000-8000-000000000004',
      intent: 'known',
      diagnosticMode: 'manual',
      knownWorkMode: 'canned',
      selectedDiagnostic: {
        id: '00000000-0000-4000-8000-000000000005',
        fingerprint: 'a'.repeat(64),
      },
      selectedKnownWork: {
        id: '00000000-0000-4000-8000-000000000006',
        fingerprint: 'b'.repeat(64),
      },
      customDiagnosticDescription: 'Fuel-pressure test and electrical checks',
      customDiagnosticHours: '1.5',
      customDiagnosticPrice: '189.00',
      requestedServiceKind: 'repair',
      requestedServiceDescription: 'Replace the failed fuel pump module',
      customerSuppliedPartsNote: 'Customer supplied unopened module',
      quoteMode: 'manual',
      selectedCannedJob: {
        id: '00000000-0000-4000-8000-000000000007',
        fingerprint: 'c'.repeat(64),
      },
      workKind: 'maintenance',
      requestedWork: 'Customer requests oil service',
    },
    pending: {
      signature: '{"vehicleMode":"existing"}',
      clientKey: '00000000-0000-4000-8000-000000000008',
    },
  }
}

function scope(surface: TicketIntakeDraft['surface']) {
  return { actorId, surface, now }
}

describe('ticket intake draft codec', () => {
  it('round-trips every Write-up field, saved-work fingerprint, assignment, existing vehicle, and pending retry identity', () => {
    const value = draft('write_up')

    const parsed = parseTicketIntakeDraft(encodeTicketIntakeDraft(value, now), scope('write_up'))

    expect(parsed).toEqual({ ...value, actorId: actorId.toLowerCase() })
  })

  it('round-trips every Quick Ticket field and a draft without an ambiguous submission', () => {
    const value = { ...draft('quick_ticket'), pending: null }

    const parsed = parseTicketIntakeDraft(encodeTicketIntakeDraft(value, now), scope('quick_ticket'))

    expect(parsed).toEqual({ ...value, actorId: actorId.toLowerCase() })
  })

  it('keys storage only by normalized actor UUID and the declared surface', () => {
    expect(ticketIntakeDraftKey(actorId, 'write_up')).toBe(
      'ticket-intake-draft:a0b1c2d3-e4f5-4a67-8b9c-0d1e2f3a4b5c:write_up',
    )
    expect(ticketIntakeDraftKey('not-an-actor', 'quick_ticket')).toBeNull()
  })

  it('normalizes every persisted UUID without changing typed form text', () => {
    const value = draft('quick_ticket')
    value.form.existingVehicleId = value.form.existingVehicleId!.toUpperCase()
    value.form.assignedTechId = value.form.assignedTechId!.toUpperCase()
    value.form.selectedCannedJob = {
      ...value.form.selectedCannedJob!, id: value.form.selectedCannedJob!.id.toUpperCase(),
    }
    value.pending = { ...value.pending!, clientKey: value.pending!.clientKey.toUpperCase() }

    const parsed = parseTicketIntakeDraft(encodeTicketIntakeDraft(value, now), scope('quick_ticket'))

    expect(parsed?.form.existingVehicleId).toBe('00000000-0000-4000-8000-000000000003')
    expect(parsed?.form.assignedTechId).toBe('00000000-0000-4000-8000-000000000004')
    expect(parsed?.form.selectedCannedJob?.id).toBe('00000000-0000-4000-8000-000000000007')
    expect(parsed?.pending?.clientKey).toBe('00000000-0000-4000-8000-000000000008')
    expect(parsed?.form.concern).toBe('Intermittent no-start after fuel stop')
  })

  it('rejects a draft from another actor or surface instead of restoring cross-scope text', () => {
    const raw = encodeTicketIntakeDraft(draft('write_up'), now)

    expect(parseTicketIntakeDraft(raw, { actorId: otherActorId, surface: 'write_up', now })).toBeNull()
    expect(parseTicketIntakeDraft(raw, scope('quick_ticket'))).toBeNull()
  })

  it('rejects corrupt, oversized, future, and expired storage without throwing', () => {
    const raw = encodeTicketIntakeDraft(draft('write_up'), now)
    if (!raw) throw new Error('valid draft did not encode')
    const future = raw.replace('2026-08-03T17:00:00.000Z', '2026-08-03T17:00:00.001Z')
    const expired = raw.replace('2026-08-03T17:00:00.000Z', '2026-08-03T04:59:59.999Z')

    expect(() => parseTicketIntakeDraft('{', scope('write_up'))).not.toThrow()
    expect(parseTicketIntakeDraft('{', scope('write_up'))).toBeNull()
    expect(parseTicketIntakeDraft('x'.repeat(16 * 1024 + 1), scope('write_up'))).toBeNull()
    expect(parseTicketIntakeDraft(future, scope('write_up'))).toBeNull()
    expect(parseTicketIntakeDraft(expired, scope('write_up'))).toBeNull()
  })

  it('rejects extra keys, invalid UUIDs, enum changes, out-of-bounds text, and malformed pending identities', () => {
    const encoded = encodeTicketIntakeDraft(draft('write_up'), now)
    if (!encoded) throw new Error('valid draft did not encode')
    const raw = JSON.parse(encoded) as Record<string, unknown>
    const invalid = (mutate: (value: Record<string, unknown>) => void) => {
      const next = structuredClone(raw)
      mutate(next)
      return parseTicketIntakeDraft(JSON.stringify(next), scope('write_up'))
    }

    expect(invalid((value) => { value.extra = true })).toBeNull()
    expect(invalid((value) => { value.actorId = 'not-a-uuid' })).toBeNull()
    expect(invalid((value) => { (value.form as Record<string, unknown>).workKind = 'diagnostic' })).toBeNull()
    expect(invalid((value) => { (value.form as Record<string, unknown>).name = 'x'.repeat(201) })).toBeNull()
    expect(invalid((value) => { value.pending = { signature: '', clientKey: 'not-a-uuid' } })).toBeNull()
  })
})
