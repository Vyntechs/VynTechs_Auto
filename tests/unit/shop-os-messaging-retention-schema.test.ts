import { getTableColumns } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import {
  messagingConsentEvents,
  messagingConsentState,
  smsSuppressions,
  messagingDeletionRequests,
  messagingRetentionHolds,
} from '@/lib/db/schema'
import {
  createTestDb,
  ensureMessagingRetentionMigration,
} from '@/tests/helpers/db'

const hex = 'a'.repeat(64)
const otherHex = 'b'.repeat(64)

async function seedTenant(client: PGlite) {
  const shopId = crypto.randomUUID()
  const customerId = crypto.randomUUID()
  const actorId = crypto.randomUUID()
  await client.query('insert into shops (id, name) values ($1, $2)', [shopId, 'Schema Shop'])
  await client.query(
    'insert into customers (id, shop_id, name, phone) values ($1, $2, $3, $4)',
    [customerId, shopId, 'Schema Customer', '+15550000000'],
  )
  await client.query(
    'insert into profiles (id, user_id, shop_id, full_name) values ($1, $2, $3, $4)',
    [actorId, crypto.randomUUID(), shopId, 'Schema Actor'],
  )
  return { shopId, customerId, actorId }
}

async function insertConsentEvent(
  client: PGlite,
  tenant: Awaited<ReturnType<typeof seedTenant>>,
  overrides: Partial<{
    destinationFingerprint: string
    fingerprintKeyVersion: string
    programVersion: string
    eventType: string
    captureMethod: string
    disclosureSnapshot: unknown
    disclosureHash: string | null
    evidenceKind: string
    requestFingerprint: string
  }> = {},
) {
  const id = crypto.randomUUID()
  const values = {
    destinationFingerprint: hex,
    fingerprintKeyVersion: 'key_v1',
    programVersion: 'repair_updates_v1',
    eventType: 'consented',
    captureMethod: 'customer_web',
    disclosureSnapshot: { disclosure: 'v1' },
    disclosureHash: otherHex,
    evidenceKind: 'customer_checkbox',
    requestFingerprint: hex,
    ...overrides,
  }
  await client.query(
    `insert into messaging_consent_events (
      id, shop_id, subject_key, customer_id, destination_fingerprint,
      fingerprint_key_version, program_version, event_type, occurred_at,
      capture_method, customer_controlled, disclosure_snapshot, disclosure_hash,
      evidence_kind, actor_profile_id, request_key, request_fingerprint, retain_until
    ) values (
      $1, $2, $3, $4, $5, $6, $7, $8, now(), $9, true, $10, $11,
      $12, $13, $14, $15, now() + interval '5 years'
    )`,
    [
      id,
      tenant.shopId,
      crypto.randomUUID(),
      tenant.customerId,
      values.destinationFingerprint,
      values.fingerprintKeyVersion,
      values.programVersion,
      values.eventType,
      values.captureMethod,
      values.disclosureSnapshot,
      values.disclosureHash,
      values.evidenceKind,
      tenant.actorId,
      crypto.randomUUID(),
      values.requestFingerprint,
    ],
  )
  return id
}

describe('Shop OS messaging retention source schema', () => {
  it('declares the five core compliance tables', () => {
    expect([
      messagingConsentEvents,
      messagingConsentState,
      smsSuppressions,
      messagingDeletionRequests,
      messagingRetentionHolds,
    ].map((table) => getTableConfig(table).name)).toEqual([
      'messaging_consent_events',
      'messaging_consent_state',
      'sms_suppressions',
      'messaging_deletion_requests',
      'messaging_retention_holds',
    ])
    expect(getTableColumns(messagingConsentEvents)).toMatchObject({
      id: expect.anything(),
      shopId: expect.anything(),
      subjectKey: expect.anything(),
      customerId: expect.anything(),
      destinationFingerprint: expect.anything(),
      fingerprintKeyVersion: expect.anything(),
      programVersion: expect.anything(),
      eventType: expect.anything(),
      committedAt: expect.anything(),
      occurredAt: expect.anything(),
      captureMethod: expect.anything(),
      customerControlled: expect.anything(),
      disclosureSnapshot: expect.anything(),
      disclosureHash: expect.anything(),
      evidenceKind: expect.anything(),
      evidenceRef: expect.anything(),
      actorProfileId: expect.anything(),
      requestKey: expect.anything(),
      requestFingerprint: expect.anything(),
      retainUntil: expect.anything(),
    })
  })

  it('applies the guarded migration through the standard fixture and rechecks idempotently', async () => {
    const fixture = await createTestDb()
    try {
      await expect(ensureMessagingRetentionMigration(fixture.client)).resolves.toBeUndefined()
      const result = await fixture.client.query<{ count: number }>(`
        select count(*)::int as count
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in (
            'messaging_consent_events', 'messaging_consent_state', 'sms_suppressions',
            'messaging_deletion_requests', 'messaging_retention_holds'
          )
      `)
      expect(result.rows[0]?.count).toBe(5)
    } finally {
      await fixture.close()
    }
  })

  it('refuses a partially hardened ephemeral schema', async () => {
    const fixture = await createTestDb()
    try {
      await fixture.client.exec(
        'drop trigger messaging_consent_events_append_only on messaging_consent_events',
      )
      await expect(ensureMessagingRetentionMigration(fixture.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
    } finally {
      await fixture.close()
    }
  })

  it('rejects cross-shop customer, actor, and source-event references', async () => {
    const fixture = await createTestDb()
    try {
      const first = await seedTenant(fixture.client)
      const second = await seedTenant(fixture.client)
      await expect(insertConsentEvent(fixture.client, {
        ...first,
        customerId: second.customerId,
      })).rejects.toThrow(/messaging_consent_events_shop_customer_fk/)
      await expect(insertConsentEvent(fixture.client, {
        ...first,
        actorId: second.actorId,
      })).rejects.toThrow(/messaging_consent_events_shop_actor_fk/)
      const sourceEventId = await insertConsentEvent(fixture.client, first)
      await expect(fixture.client.query(
        `insert into messaging_consent_state (
          shop_id, subject_key, customer_id, destination_fingerprint,
          fingerprint_key_version, program_version, status, source_event_id,
          consented_at, retain_until
        ) values ($1, $2, $3, $4, 'key_v1', 'repair_updates_v1', 'consented', $5, now(), now() + interval '5 years')`,
        [second.shopId, crypto.randomUUID(), second.customerId, hex, sourceEventId],
      )).rejects.toThrow(/messaging_consent_state_shop_source_event_fk/)
    } finally {
      await fixture.close()
    }
  })

  it.each([
    ['destination fingerprint', { destinationFingerprint: 'not-hex' }],
    ['disclosure hash', { disclosureHash: 'not-hex' }],
    ['request fingerprint', { requestFingerprint: 'not-hex' }],
    ['key version', { fingerprintKeyVersion: 'Key V1' }],
    ['program version', { programVersion: 'Repair Updates' }],
    ['event type', { eventType: 'maybe' }],
    ['capture method', { captureMethod: 'guess' }],
    ['evidence kind', { evidenceKind: 'raw_payload' }],
  ])('rejects an invalid %s', async (_label, overrides) => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedTenant(fixture.client)
      await expect(insertConsentEvent(fixture.client, tenant, overrides)).rejects.toThrow()
    } finally {
      await fixture.close()
    }
  })

  it('rejects invalid projected consent status and suppression reason values', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedTenant(fixture.client)
      const sourceEventId = await insertConsentEvent(fixture.client, tenant)
      await expect(fixture.client.query(
        `insert into messaging_consent_state (
          shop_id, subject_key, customer_id, destination_fingerprint,
          fingerprint_key_version, program_version, status, source_event_id,
          retain_until
        ) values ($1, $2, $3, $4, 'key_v1', 'repair_updates_v1', 'unknown', $5,
          now() + interval '5 years')`,
        [tenant.shopId, crypto.randomUUID(), tenant.customerId, hex, sourceEventId],
      )).rejects.toThrow(/messaging_consent_state_status_valid/)
      await expect(fixture.client.query(
        `insert into sms_suppressions (
          shop_id, destination_fingerprint, fingerprint_key_version,
          source_event_id, reason, retain_until
        ) values ($1, $2, 'key_v1', $3, 'temporary', now() + interval '5 years')`,
        [tenant.shopId, hex, sourceEventId],
      )).rejects.toThrow(/sms_suppressions_reason_valid/)
    } finally {
      await fixture.close()
    }
  })

  it('rejects non-object and over-4-KiB compliance JSON', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedTenant(fixture.client)
      await expect(insertConsentEvent(fixture.client, tenant, {
        disclosureSnapshot: ['not', 'object'],
      })).rejects.toThrow(/messaging_consent_events_disclosure_snapshot_object/)
      await expect(insertConsentEvent(fixture.client, tenant, {
        disclosureSnapshot: { value: 'x'.repeat(4097) },
      })).rejects.toThrow(/messaging_consent_events_disclosure_snapshot_size/)

      await expect(fixture.client.query(
        `insert into messaging_deletion_requests (
          request_key, request_fingerprint, shop_id, subject_key, customer_id,
          destination_fingerprint, fingerprint_key_version, state, reason_code,
          requesting_actor_profile_id, prior_record_counts
        ) values ($1, $2, $3, $4, $5, $6, 'key_v1', 'pending', 'customer_request', $7, $8)`,
        [crypto.randomUUID(), hex, tenant.shopId, crypto.randomUUID(), tenant.customerId, hex,
          tenant.actorId, ['not-object']],
      )).rejects.toThrow(/messaging_deletion_requests_prior_counts_object/)

      await expect(fixture.client.query(
        `insert into messaging_deletion_requests (
          request_key, request_fingerprint, shop_id, subject_key, customer_id,
          destination_fingerprint, fingerprint_key_version, state, reason_code,
          requesting_actor_profile_id, completed_at, prior_record_counts,
          proof_summary, retain_until
        ) values ($1, $2, $3, $4, null, $5, 'key_v1', 'completed',
          'customer_request', $6, now(), '{}'::jsonb, $7, now() + interval '5 years')`,
        [crypto.randomUUID(), hex, tenant.shopId, crypto.randomUUID(), hex,
          tenant.actorId, { value: 'x'.repeat(4097) }],
      )).rejects.toThrow(/messaging_deletion_requests_proof_summary_size/)
    } finally {
      await fixture.close()
    }
  })

  it('enforces pending and completed deletion tombstone consistency', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedTenant(fixture.client)
      const base = [crypto.randomUUID(), hex, tenant.shopId, crypto.randomUUID(), tenant.customerId,
        hex, tenant.actorId]
      await expect(fixture.client.query(
        `insert into messaging_deletion_requests (
          request_key, request_fingerprint, shop_id, subject_key, customer_id,
          destination_fingerprint, fingerprint_key_version, state, reason_code,
          requesting_actor_profile_id, completed_at, proof_summary, retain_until
        ) values ($1, $2, $3, $4, $5, $6, 'key_v1', 'completed', 'customer_request', $7,
          now(), '{}'::jsonb, now() + interval '5 years')`,
        base,
      )).rejects.toThrow(/messaging_deletion_requests_state_consistent/)

      await expect(fixture.client.query(
        `insert into messaging_deletion_requests (
          request_key, request_fingerprint, shop_id, subject_key, customer_id,
          destination_fingerprint, fingerprint_key_version, state, reason_code,
          requesting_actor_profile_id, completed_at
        ) values ($1, $2, $3, $4, $5, $6, 'key_v1', 'pending', 'customer_request', $7, now())`,
        [crypto.randomUUID(), hex, tenant.shopId, crypto.randomUUID(), tenant.customerId, hex,
          tenant.actorId],
      )).rejects.toThrow(/messaging_deletion_requests_state_consistent/)
    } finally {
      await fixture.close()
    }
  })

  it('bounds retention holds to 365 days', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedTenant(fixture.client)
      await expect(fixture.client.query(
        `insert into messaging_retention_holds (
          shop_id, subject_key, reason_code, authorizing_actor_profile_id,
          starts_at, review_at, expires_at, retain_until
        ) values ($1, $2, 'legal_claim', $3, now(), now() + interval '30 days',
          now() + interval '366 days', now() + interval '5 years')`,
        [tenant.shopId, crypto.randomUUID(), tenant.actorId],
      )).rejects.toThrow(/messaging_retention_holds_max_duration/)
    } finally {
      await fixture.close()
    }
  })

  it('rejects direct consent-event updates and deletes', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedTenant(fixture.client)
      const eventId = await insertConsentEvent(fixture.client, tenant)
      await expect(fixture.client.query(
        'update messaging_consent_events set evidence_ref = $1 where id = $2',
        ['changed', eventId],
      )).rejects.toThrow(/messaging consent events are append-only/)
      await expect(fixture.client.query(
        'delete from messaging_consent_events where id = $1',
        [eventId],
      )).rejects.toThrow(/messaging consent events are append-only/)
    } finally {
      await fixture.close()
    }
  })

  it('allows pending-to-completed once and rejects completed tombstone mutation', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedTenant(fixture.client)
      const requestId = crypto.randomUUID()
      await fixture.client.query(
        `insert into messaging_deletion_requests (
          id, request_key, request_fingerprint, shop_id, subject_key, customer_id,
          destination_fingerprint, fingerprint_key_version, state, reason_code,
          requesting_actor_profile_id
        ) values ($1, $2, $3, $4, $5, $6, $7, 'key_v1', 'pending', 'customer_request', $8)`,
        [requestId, crypto.randomUUID(), hex, tenant.shopId, crypto.randomUUID(),
          tenant.customerId, hex, tenant.actorId],
      )
      await fixture.client.query(
        `update messaging_deletion_requests set
          state = 'completed', customer_id = null, completed_at = now(),
          prior_record_counts = '{}'::jsonb, proof_summary = '{}'::jsonb,
          retain_until = now() + interval '5 years'
        where id = $1`,
        [requestId],
      )
      await expect(fixture.client.query(
        'update messaging_deletion_requests set proof_summary = $1 where id = $2',
        [{ changed: true }, requestId],
      )).rejects.toThrow(/completed messaging deletion tombstones are immutable/)
    } finally {
      await fixture.close()
    }
  })
})
