import { describe, expect, it } from 'vitest'
import * as schema from '@/lib/db/schema'
import { createTestDb } from '@/tests/helpers/db'
import {
  appendTicketActivity,
  isTicketCorrectionReceiptV1,
} from '@/lib/shop-os/ticket-activity'
import { getTicketDetail, ticketActorFromProfile } from '@/lib/tickets'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

async function createCorrectionFixture() {
  const testDb = await createTestDb()
  const [shop] = await testDb.db.insert(schema.shops).values({ name: 'Correction Activity Shop' }).returning()
  const [actor] = await testDb.db.insert(schema.profiles).values({
    id: uuid(501),
    userId: uuid(601),
    shopId: shop.id,
    fullName: 'Correction Advisor',
    role: 'advisor',
  }).returning()
  const [ticket] = await testDb.db.insert(schema.tickets).values({
    shopId: shop.id,
    ticketNumber: 1,
    source: 'tech_quick',
    concern: 'Brake squeal',
    createdByProfileId: actor.id,
  }).returning()
  const [job] = await testDb.db.insert(schema.ticketJobs).values({
    shopId: shop.id,
    ticketId: ticket.id,
    title: 'Brake inspection',
    kind: 'repair',
    requiredSkillTier: 2,
  }).returning()
  return { ...testDb, shop, actor, ticket, job }
}

describe('ticket activity persistence contract', () => {
  it('exposes a tenant-bound append-only ticket activity table', () => {
    const activity = (schema as Record<string, unknown>).ticketActivity

    expect(activity).toBeDefined()
  })

  it('defines the complete finite set of interruption receipts', () => {
    const kinds = (schema as Record<string, unknown>).TICKET_ACTIVITY_KINDS

    expect(kinds).toEqual([
      'work_paused',
      'work_resumed',
      'job_blocked',
      'job_hold_resolved',
      'job_reassigned',
      'job_handed_off',
      'ticket_canceled',
      'ticket_reopened',
      'ticket_corrected',
    ])
  })

  it('applies the ledger migration to every ephemeral database', async () => {
    const { client, close } = await createTestDb()
    try {
      const result = await client.query<{ table_count: number; index_count: number }>(`
        select
          (select count(*)::int
        from information_schema.tables
        where table_schema = 'public' and table_name = 'ticket_activity'
          ) as table_count,
          (select count(*)::int
           from pg_indexes
           where schemaname = 'public' and tablename = 'ticket_activity'
             and indexname in ('ticket_activity_shop_ticket_job_fk_idx', 'ticket_activity_shop_actor_fk_idx')
          ) as index_count
      `)

      expect(result.rows[0]).toMatchObject({ table_count: 1, index_count: 2 })
    } finally {
      await close()
    }
  })

  it('records an interruption receipt once for an idempotent request key', async () => {
    const { db, close } = await createTestDb()
    try {
      const [shop] = await db.insert(schema.shops).values({ name: 'Activity Shop' }).returning()
      const [actor] = await db.insert(schema.profiles).values({
        userId: '00000000-0000-4000-8000-000000000001',
        shopId: shop.id,
        fullName: 'Activity Advisor',
        role: 'advisor',
      }).returning()
      const [ticket] = await db.insert(schema.tickets).values({
        shopId: shop.id,
        ticketNumber: 1,
        source: 'tech_quick',
        concern: 'Brake squeal',
        createdByProfileId: actor.id,
      }).returning()
      const input = {
        shopId: shop.id,
        ticketId: ticket.id,
        actorProfileId: actor.id,
        kind: 'ticket_canceled' as const,
        requestKey: '00000000-0000-4000-8000-000000000002',
        payload: { reason: 'Customer rescheduled', interruptedJobs: [] },
      }

      const first = await appendTicketActivity(db, input)
      const replay = await appendTicketActivity(db, input)
      const rows = await db.select().from(schema.ticketActivity)

      expect(first).toMatchObject({ ok: true, created: true })
      expect(replay).toMatchObject({ ok: true, created: false })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        shopId: shop.id,
        ticketId: ticket.id,
        actorProfileId: actor.id,
        kind: 'ticket_canceled',
        requestKey: input.requestKey,
        payload: input.payload,
      })
      await expectAppendOnlyFailure(db.update(schema.ticketActivity).set({ kind: 'ticket_reopened' }))
      await expectAppendOnlyFailure(db.delete(schema.ticketActivity))
    } finally {
      await close()
    }
  })

  it('treats semantically identical payload key order as the same retry', async () => {
    const { db, close } = await createTestDb()
    try {
      const [shop] = await db.insert(schema.shops).values({ name: 'Canonical Activity Shop' }).returning()
      const [actor] = await db.insert(schema.profiles).values({
        userId: '00000000-0000-4000-8000-000000000011',
        shopId: shop.id,
        fullName: 'Canonical Advisor',
        role: 'advisor',
      }).returning()
      const [ticket] = await db.insert(schema.tickets).values({
        shopId: shop.id,
        ticketNumber: 1,
        source: 'tech_quick',
        concern: 'Brake squeal',
        createdByProfileId: actor.id,
      }).returning()
      const base = {
        shopId: shop.id,
        ticketId: ticket.id,
        actorProfileId: actor.id,
        kind: 'ticket_canceled' as const,
        requestKey: '00000000-0000-4000-8000-000000000012',
      }

      await expect(appendTicketActivity(db, {
        ...base,
        payload: { reason: 'Customer rescheduled', interruptedJobs: [] },
      })).resolves.toMatchObject({ ok: true, created: true })
      await expect(appendTicketActivity(db, {
        ...base,
        payload: { interruptedJobs: [], reason: 'Customer rescheduled' },
      })).resolves.toMatchObject({ ok: true, created: false })
    } finally {
      await close()
    }
  })

  it('records one append-only job-scoped correction receipt for an idempotent request key', async () => {
    const fixture = await createCorrectionFixture()
    try {
      const input = {
        shopId: fixture.shop.id,
        ticketId: fixture.ticket.id,
        jobId: fixture.job.id,
        actorProfileId: fixture.actor.id,
        kind: 'ticket_corrected' as never,
        requestKey: uuid(502),
        payload: {
          v: 1,
          scope: 'job',
          intentHash: 'a'.repeat(64),
          changedFields: ['title'],
        },
      }

      await expect(appendTicketActivity(fixture.db, input))
        .resolves.toEqual({ ok: true, created: true })
      await expect(appendTicketActivity(fixture.db, input))
        .resolves.toEqual({ ok: true, created: false })
      const rows = await fixture.db.select().from(schema.ticketActivity)
      expect(rows).toEqual([expect.objectContaining({
        jobId: fixture.job.id,
        kind: 'ticket_corrected',
        payload: input.payload,
      })])
      await expectAppendOnlyFailure(
        fixture.db.update(schema.ticketActivity).set({ payload: { changed: true } }),
      )
      await expectAppendOnlyFailure(fixture.db.delete(schema.ticketActivity))
    } finally {
      await fixture.close()
    }
  })

  it.each([
    ['identity', null, {
      v: 1,
      scope: 'identity',
      intentHash: 'd'.repeat(64),
      changedFields: ['customer_id', 'vehicle_id'],
      fromCustomerId: uuid(520),
      toCustomerId: uuid(521),
      fromVehicleId: uuid(522),
      toVehicleId: uuid(523),
    }],
    ['concern', null, {
      v: 1,
      scope: 'concern',
      intentHash: 'd'.repeat(64),
      changedFields: ['concern'],
      invalidatedVersionId: null,
      invalidatedVersionNumber: null,
    }],
    ['job', uuid(524), {
      v: 1,
      scope: 'job',
      intentHash: 'd'.repeat(64),
      changedFields: ['title', 'kind', 'customer_supplied_parts_note'],
      fromKind: 'diagnostic',
      toKind: 'repair',
      invalidatedVersionId: uuid(525),
      invalidatedVersionNumber: 2,
    }],
    ['job removal', uuid(526), {
      v: 1,
      scope: 'job_removed',
      intentHash: 'd'.repeat(64),
      changedFields: ['work_status'],
    }],
  ])('accepts the exact privacy-minimized %s receipt envelope', (_label, jobId, payload) => {
    expect(isTicketCorrectionReceiptV1(payload, jobId)).toBe(true)
  })

  it.each([
    ['reordered fields', null, {
      v: 1, scope: 'identity', intentHash: 'd'.repeat(64),
      changedFields: ['vehicle_id', 'customer_id'],
      fromCustomerId: uuid(520), toCustomerId: uuid(521),
      fromVehicleId: uuid(522), toVehicleId: uuid(523),
    }],
    ['duplicate fields', uuid(524), {
      v: 1, scope: 'job', intentHash: 'd'.repeat(64), changedFields: ['title', 'title'],
    }],
    ['unchanged identity IDs', null, {
      v: 1, scope: 'identity', intentHash: 'd'.repeat(64), changedFields: ['customer_id'],
      fromCustomerId: uuid(520), toCustomerId: uuid(520),
    }],
    ['missing kind transition', uuid(524), {
      v: 1, scope: 'job', intentHash: 'd'.repeat(64), changedFields: ['kind'],
    }],
  ])('rejects the non-canonical %s receipt envelope', (_label, jobId, payload) => {
    expect(isTicketCorrectionReceiptV1(payload, jobId)).toBe(false)
  })

  it.each([
    ['a raw free-text key', {
      jobId: null,
      payload: {
        v: 1, scope: 'concern', intentHash: 'c'.repeat(64),
        changedFields: ['concern'], customerName: 'must never persist',
      },
    }],
    ['a malformed intent hash', {
      jobId: null,
      payload: { v: 1, scope: 'concern', intentHash: 'not-a-hash', changedFields: ['concern'] },
    }],
    ['a non-canonical changed field', {
      jobId: null,
      payload: { v: 1, scope: 'concern', intentHash: 'c'.repeat(64), changedFields: ['title'] },
    }],
    ['a scope and job envelope mismatch', {
      jobId: null,
      payload: { v: 1, scope: 'job', intentHash: 'c'.repeat(64), changedFields: ['title'] },
    }],
    ['an incomplete invalidated-version pair', {
      jobId: null,
      payload: {
        v: 1, scope: 'concern', intentHash: 'c'.repeat(64), changedFields: ['concern'],
        invalidatedVersionId: uuid(504),
      },
    }],
  ])('rejects %s before querying the immutable correction ledger', async (_label, invalid) => {
    const fixture = await createCorrectionFixture()
    try {
      await expect(appendTicketActivity(fixture.db, {
        shopId: fixture.shop.id,
        ticketId: fixture.ticket.id,
        jobId: invalid.jobId,
        actorProfileId: fixture.actor.id,
        kind: 'ticket_corrected' as never,
        requestKey: uuid(505),
        payload: invalid.payload,
      })).resolves.toEqual({ ok: false, error: 'conflict' })
      expect(await fixture.db.select().from(schema.ticketActivity)).toEqual([])
    } finally {
      await fixture.close()
    }
  })

  it.each([
    ['an unknown kind', { kind: 'future_kind', payload: {} }],
    ['a non-object payload', { kind: 'ticket_corrected', payload: [] }],
    ['an oversized payload', { kind: 'ticket_corrected', payload: { value: 'x'.repeat(12_289) } }],
  ])('rejects %s at the database boundary', async (_label, invalid) => {
    const fixture = await createCorrectionFixture()
    try {
      await expectCheckFailure(fixture.db.insert(schema.ticketActivity).values({
        shopId: fixture.shop.id,
        ticketId: fixture.ticket.id,
        actorProfileId: fixture.actor.id,
        kind: invalid.kind as never,
        requestKey: uuid(503),
        payload: invalid.payload as never,
      }))
    } finally {
      await fixture.close()
    }
  })

  it('projects only exact correction scopes into safe copy and never exposes raw corrected values', async () => {
    const fixture = await createCorrectionFixture()
    try {
      const secret = 'SECRET-RAW-CUSTOMER-VEHICLE-CONCERN-TITLE'
      const payloads = [
        { scope: 'identity', jobId: null },
        { scope: 'concern', jobId: null },
        { scope: 'job', jobId: fixture.job.id },
        { scope: 'job_removed', jobId: fixture.job.id },
        { scope: ' identity', jobId: null },
        { scope: { nested: 'concern' }, jobId: null },
      ] as const
      await fixture.db.insert(schema.ticketActivity).values(payloads.map((entry, index) => ({
        shopId: fixture.shop.id,
        ticketId: fixture.ticket.id,
        jobId: entry.jobId,
        actorProfileId: fixture.actor.id,
        kind: 'ticket_corrected' as never,
        requestKey: uuid(510 + index),
        payload: {
          v: 1,
          scope: entry.scope,
          intentHash: 'b'.repeat(64),
          changedFields: ['customerName', 'vehicleVin', 'concern', 'title'],
          customerName: secret,
          vehicleVin: secret,
          concern: secret,
          title: secret,
        },
      })))
      await fixture.db.insert(schema.ticketActivity).values({
        shopId: fixture.shop.id,
        ticketId: fixture.ticket.id,
        jobId: fixture.job.id,
        actorProfileId: fixture.actor.id,
        kind: 'ticket_canceled',
        requestKey: uuid(519),
        payload: { scope: 'job_removed' },
      })

      const detail = await getTicketDetail(fixture.db, {
        actor: ticketActorFromProfile(fixture.actor),
        ticketId: fixture.ticket.id,
      })
      expect(detail.ok).toBe(true)
      if (!detail.ok) return
      const summaries = detail.ticket.activities?.map((activity) => activity.summary) ?? []
      expect(summaries).toEqual(expect.arrayContaining([
        'Customer or vehicle corrected.',
        'Concern corrected.',
        'Brake inspection: Details corrected.',
        'Brake inspection: Removed from active work. It remains in History.',
        'Repair order corrected.',
      ]))
      expect(summaries.filter((summary) => summary === 'Repair order corrected.')).toHaveLength(2)
      expect(detail.ticket.activities?.find((activity) => (
        activity.summary === 'Customer or vehicle corrected.'
      ))?.correctionScope).toBe('identity')
      expect(detail.ticket.activities?.find((activity) => (
        activity.summary === 'Brake inspection: Removed from active work. It remains in History.'
      ))?.correctionScope).toBe('job_removed')
      expect(detail.ticket.activities?.filter((activity) => (
        activity.summary === 'Repair order corrected.'
      )).every((activity) => activity.correctionScope === null)).toBe(true)
      const ordinaryCancellation = detail.ticket.activities?.find((activity) => (
        activity.kind === 'ticket_canceled'
      ))
      expect(ordinaryCancellation?.correctionScope).toBeNull()
      expect(ordinaryCancellation?.summary).toContain('customer declined')
      expect(ordinaryCancellation?.summary).not.toContain('Removed')
      expect(JSON.stringify(detail.ticket.activities)).not.toContain(secret)
    } finally {
      await fixture.close()
    }
  })
})

async function expectAppendOnlyFailure(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toSatisfy((error: unknown) => {
    let current = error
    for (let depth = 0; current && depth < 5; depth += 1) {
      if (current instanceof Error && current.message.includes('ticket activity is append-only')) {
        return true
      }
      current = typeof current === 'object' && current !== null && 'cause' in current
        ? current.cause
        : null
    }
    return false
  })
}

async function expectCheckFailure(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toSatisfy((error: unknown) => {
    let current = error
    for (let depth = 0; current && depth < 5; depth += 1) {
      if (typeof current === 'object' && current !== null && 'code' in current && current.code === '23514') {
        return true
      }
      current = typeof current === 'object' && current !== null && 'cause' in current
        ? current.cause
        : null
    }
    return false
  })
}
