import { describe, expect, it } from 'vitest'
import * as schema from '@/lib/db/schema'
import { createTestDb } from '@/tests/helpers/db'
import { appendTicketActivity } from '@/lib/shop-os/ticket-activity'

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
    ])
  })

  it('applies the ledger migration to every ephemeral database', async () => {
    const { client, close } = await createTestDb()
    try {
      const result = await client.query<{ count: number }>(`
        select count(*)::int as count
        from information_schema.tables
        where table_schema = 'public' and table_name = 'ticket_activity'
      `)

      expect(result.rows[0]?.count).toBe(1)
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
