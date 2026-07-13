import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getTableColumns } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import * as dbSchema from '@/lib/db/schema'
import {
  messagingConsentEvents,
  messagingConsentState,
  smsSuppressions,
  messagingDeletionRequests,
  messagingDeletionWorkItems,
  messagingRetentionHolds,
  quoteEvents,
  quoteSends,
  smsLog,
  notifications,
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

async function seedOperationalTenant(client: PGlite) {
  const tenant = await seedTenant(client)
  const ticketId = crypto.randomUUID()
  const quoteVersionId = crypto.randomUUID()
  await client.query(
    `insert into tickets (
      id, shop_id, ticket_number, source, concern, created_by_profile_id
    ) values ($1, $2, 1, 'tech_quick', 'Schema concern', $3)`,
    [ticketId, tenant.shopId, tenant.actorId],
  )
  await client.query(
    `insert into quote_versions (
      id, shop_id, ticket_id, version_number, snapshot, created_by_profile_id
    ) values ($1, $2, $3, 1, '{}'::jsonb, $4)`,
    [quoteVersionId, tenant.shopId, ticketId, tenant.actorId],
  )
  return { ...tenant, ticketId, quoteVersionId }
}

async function insertQuoteSend(
  client: PGlite,
  tenant: Awaited<ReturnType<typeof seedOperationalTenant>>,
  overrides: Partial<{
    shopId: string
    ticketId: string
    quoteVersionId: string
    customerId: string
    subjectKey: string
    actorId: string
    tokenHash: string | null
    tokenExpiresAt: string | null
    state: string
    submittingAt: string | null
    submittedAt: string | null
    terminalAt: string | null
    retainUntil: string | null
    requestKey: string
    requestFingerprint: string
    destinationFingerprint: string
    fingerprintKeyVersion: string
    createdAt: string
  }> = {},
) {
  const values = {
    shopId: tenant.shopId,
    ticketId: tenant.ticketId,
    quoteVersionId: tenant.quoteVersionId,
    customerId: tenant.customerId,
    subjectKey: tenant.customerId,
    actorId: tenant.actorId,
    tokenHash: hex,
    tokenExpiresAt: "now() + interval '1 day'",
    state: 'queued',
    submittingAt: null,
    submittedAt: null,
    terminalAt: null,
    retainUntil: null,
    requestKey: crypto.randomUUID(),
    requestFingerprint: otherHex,
    destinationFingerprint: hex,
    fingerprintKeyVersion: 'key_v1',
    createdAt: 'now()',
    ...overrides,
  }
  const result = await client.query<{ id: string }>(
    `insert into quote_sends (
      shop_id, ticket_id, quote_version_id, customer_id, subject_key,
      destination_fingerprint, fingerprint_key_version, channel,
      token_hash, token_expires_at, requesting_actor_profile_id,
      request_key, request_fingerprint, state, submitting_at,
      submitted_at, terminal_at, retain_until, created_at
    ) values (
      $1, $2, $3, $4, $5, $6, $7, 'sms', $8,
      ${values.tokenExpiresAt ?? 'null'}, $9, $10, $11, $12,
      ${values.submittingAt ?? 'null'}, ${values.submittedAt ?? 'null'},
      ${values.terminalAt ?? 'null'}, ${values.retainUntil ?? 'null'}, ${values.createdAt}
    ) returning id`,
    [values.shopId, values.ticketId, values.quoteVersionId, values.customerId, values.subjectKey,
      values.destinationFingerprint, values.fingerprintKeyVersion, values.tokenHash,
      values.actorId, values.requestKey, values.requestFingerprint, values.state],
  )
  return result.rows[0]!.id
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
    subjectKey: string
    customerId: string
    retainUntil: string
    committedAt: string
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
    subjectKey: crypto.randomUUID(),
    customerId: tenant.customerId,
    retainUntil: "now() + interval '5 years'",
    committedAt: 'now()',
    ...overrides,
  }
  await client.query(
    `insert into messaging_consent_events (
      id, shop_id, subject_key, customer_id, destination_fingerprint,
      fingerprint_key_version, program_version, event_type, committed_at, occurred_at,
      capture_method, customer_controlled, disclosure_snapshot, disclosure_hash,
      evidence_kind, actor_profile_id, request_key, request_fingerprint, retain_until
    ) values (
      $1, $2, $3, $4, $5, $6, $7, $8, ${values.committedAt}, now(), $9, true, $10, $11,
      $12, $13, $14, $15, ${values.retainUntil}
    )`,
    [
      id,
      tenant.shopId,
      values.subjectKey,
      values.customerId,
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

async function insertDeletionRequest(
  client: PGlite,
  tenant: Awaited<ReturnType<typeof seedTenant>>,
  input: {
    subjectKey: string
    state?: 'pending' | 'completed'
    retainUntil?: 'now' | 'future' | 'past'
    destinationFingerprint?: string
    fingerprintKeyVersion?: string
  },
) {
  const requestId = crypto.randomUUID()
  const state = input.state ?? 'pending'
  const latestRelevantAt = input.retainUntil === 'future'
    ? 'now()'
    : input.retainUntil === 'past'
      ? "now() - interval '5 years' - interval '1 second'"
      : "now() - interval '5 years'"
  const retainUntil = `${latestRelevantAt} + interval '5 years'`
  await client.query(
    `insert into messaging_deletion_requests (
      id, request_key, request_fingerprint, shop_id, subject_key, customer_id,
      destination_fingerprint, fingerprint_key_version, state, reason_code,
      requesting_actor_profile_id, completed_at, latest_relevant_at, prior_record_counts,
      proof_summary, retain_until
    ) values (
      $1, $2, $3, $4, $5, $6, $7,
      $8, '${state}', 'customer_request', $9,
      ${state === 'completed' ? latestRelevantAt : 'null'},
      ${state === 'completed' ? latestRelevantAt : 'null'},
      ${state === 'completed' ? "'{}'::jsonb" : 'null'},
      ${state === 'completed' ? "'{}'::jsonb" : 'null'},
      ${state === 'completed' ? retainUntil : 'null'}
    )`,
    [requestId, crypto.randomUUID(), hex, tenant.shopId, input.subjectKey,
      state === 'pending' ? tenant.customerId : null,
      input.destinationFingerprint ?? hex, input.fingerprintKeyVersion ?? 'key_v1',
      tenant.actorId],
  )
  return requestId
}

async function insertSuppression(
  client: PGlite,
  tenant: Awaited<ReturnType<typeof seedTenant>>,
  overrides: Partial<{
    destinationFingerprint: string
    fingerprintKeyVersion: string
    reason: string
    liftedAt: string | null
    retainUntil: string
    sourceEventId: string | null
  }> = {},
) {
  const values = {
    destinationFingerprint: hex,
    fingerprintKeyVersion: 'key_v1',
    reason: 'verified_deletion',
    liftedAt: null,
    retainUntil: "now() + interval '5 years' + interval '1 day'",
    sourceEventId: null,
    ...overrides,
  }
  await client.query(
    `insert into sms_suppressions (
      shop_id, destination_fingerprint, fingerprint_key_version, source_event_id,
      reason, suppressed_at, lifted_at, retain_until
    ) values ($1, $2, $3, $4, $5, now() - interval '1 day',
      ${values.liftedAt ?? 'null'}, ${values.retainUntil})`,
    [tenant.shopId, values.destinationFingerprint, values.fingerprintKeyVersion,
      values.sourceEventId, values.reason],
  )
}

async function insertHold(
  client: PGlite,
  tenant: Awaited<ReturnType<typeof seedTenant>>,
  target: { subjectKey: string } | { resourceType: string; resourceId: string },
) {
  const result = await client.query<{ id: string }>(
    `insert into messaging_retention_holds (
      shop_id, resource_type, resource_id, subject_key, reason_code,
      authorizing_actor_profile_id, starts_at, review_at, expires_at, retain_until
    ) values ($1, $2, $3, $4, 'legal_claim', $5,
      now() - interval '1 minute', now() + interval '1 day',
      now() + interval '30 days', now() + interval '30 days' + interval '5 years')
    returning id`,
    [
      tenant.shopId,
      'resourceType' in target ? target.resourceType : null,
      'resourceId' in target ? target.resourceId : null,
      'subjectKey' in target ? target.subjectKey : null,
      tenant.actorId,
    ],
  )
  return result.rows[0]!.id
}

describe('deletion work journal', () => {
  it('enforces request-scoped source-backed pending work items', async () => {
    const fixture = await createTestDb()
    await ensureMessagingRetentionMigration(fixture.client)
    const tenant = await seedOperationalTenant(fixture.client)
    const requestId = await insertDeletionRequest(fixture.client, tenant, {
      subjectKey: tenant.customerId,
    })
    const quoteSendId = await insertQuoteSend(fixture.client, tenant, {
      subjectKey: tenant.customerId,
    })
    const workItemId = crypto.randomUUID()

    await fixture.client.query(
      `insert into messaging_deletion_work_items (
        id, shop_id, request_id, resource_type, resource_id,
        parent_work_item_id, outcome, retention_basis,
        counts_toward_proof, detached_suppression_sources,
        discovered_at, resolved_at
      ) values (
        $1, $2, $3, 'quote_send', $4,
        null, 'pending', null,
        true, 0,
        now(), null
      )`,
      [workItemId, tenant.shopId, requestId, quoteSendId],
    )

    await expect(fixture.client.query(
      `insert into messaging_deletion_work_items (
        shop_id, request_id, resource_type, resource_id
      ) values ($1, $2, 'quote_send', $3)`,
      [tenant.shopId, requestId, quoteSendId],
    )).rejects.toThrow(/messaging_deletion_work_items_request_resource_uq/)

    const otherTenant = await seedOperationalTenant(fixture.client)
    const otherRequestId = await insertDeletionRequest(fixture.client, otherTenant, {
      subjectKey: otherTenant.customerId,
    })
    const otherQuoteSendId = await insertQuoteSend(fixture.client, otherTenant, {
      subjectKey: otherTenant.customerId,
    })
    const otherParentId = crypto.randomUUID()
    await fixture.client.query(
      `insert into messaging_deletion_work_items (
        id, shop_id, request_id, resource_type, resource_id
      ) values ($1, $2, $3, 'quote_send', $4)`,
      [otherParentId, otherTenant.shopId, otherRequestId, otherQuoteSendId],
    )

    await expect(fixture.client.query(
      `insert into messaging_deletion_work_items (
        shop_id, request_id, resource_type, resource_id
      ) values ($1, $2, 'quote_send', $3)`,
      [otherTenant.shopId, requestId, otherQuoteSendId],
    )).rejects.toThrow(/shop_request_fk|pending deletion request/)

    const smsLogId = crypto.randomUUID()
    await fixture.client.query(
      `insert into sms_log (
        id, shop_id, quote_send_id, template_key, template_version,
        state, server_received_at, retain_until
      ) values ($1, $2, $3, 'quote_ready', 'v1', 'queued', now(), now() + interval '1 year')`,
      [smsLogId, tenant.shopId, quoteSendId],
    )
    await expect(fixture.client.query(
      `insert into messaging_deletion_work_items (
        shop_id, request_id, resource_type, resource_id, parent_work_item_id
      ) values ($1, $2, 'sms_log', $3, $4)`,
      [tenant.shopId, requestId, smsLogId, otherParentId],
    )).rejects.toThrow(/parent work item/)

    for (const [outcome, retentionBasis, resolvedAt, detachedCount] of [
      ['deleted', null, 'now()', 0],
      ['retained', null, 'now()', 0],
      ['pending', null, 'now()', 0],
      ['pending', null, 'null', 1],
    ] as const) {
      const resourceId = await insertQuoteSend(fixture.client, tenant, {
        subjectKey: tenant.customerId,
      })
      await expect(fixture.client.query(
        `insert into messaging_deletion_work_items (
          shop_id, request_id, resource_type, resource_id, outcome,
          retention_basis, detached_suppression_sources, resolved_at
        ) values ($1, $2, 'quote_send', $3, $4, $5, $6, ${resolvedAt})`,
        [tenant.shopId, requestId, resourceId, outcome, retentionBasis, detachedCount],
      )).rejects.toThrow(/pending|state_consistent|detached_count_valid/)
    }

    const consentEventId = await insertConsentEvent(fixture.client, tenant, {
      subjectKey: tenant.customerId,
      customerId: tenant.customerId,
      eventType: 'consented',
      programVersion: 'repair_updates_v1',
    })
    await expect(fixture.client.query(
      `insert into messaging_deletion_work_items (
        shop_id, request_id, resource_type, resource_id, counts_toward_proof
      ) values ($1, $2, 'consent_event', $3, false)`,
      [tenant.shopId, requestId, consentEventId],
    )).rejects.toThrow(/counts_toward_proof/)

    await fixture.close()
  })

  it('accepts a same-customer historical quote-send subject and fingerprint key', async () => {
    const fixture = await createTestDb()
    const tenant = await seedOperationalTenant(fixture.client)
    const requestId = await insertDeletionRequest(fixture.client, tenant, {
      subjectKey: tenant.customerId,
      destinationFingerprint: hex,
      fingerprintKeyVersion: 'key_v1',
    })
    const historicalSubjectKey = crypto.randomUUID()
    const historicalQuoteSendId = await insertQuoteSend(fixture.client, tenant, {
      subjectKey: historicalSubjectKey,
      destinationFingerprint: otherHex,
      fingerprintKeyVersion: 'key_v0',
    })
    await fixture.client.query(
      `insert into messaging_deletion_work_items (
        shop_id, request_id, resource_type, resource_id
      ) values ($1, $2, 'quote_send', $3)`,
      [tenant.shopId, requestId, historicalQuoteSendId],
    )

    await fixture.close()
  })

  it('accepts same-customer historical consent with its exact projection parent', async () => {
    const fixture = await createTestDb()
    const tenant = await seedOperationalTenant(fixture.client)
    const requestId = await insertDeletionRequest(fixture.client, tenant, {
      subjectKey: tenant.customerId,
      destinationFingerprint: hex,
      fingerprintKeyVersion: 'key_v1',
    })
    const historicalSubjectKey = crypto.randomUUID()

    const historicalEventId = await insertConsentEvent(fixture.client, tenant, {
      subjectKey: historicalSubjectKey,
      customerId: tenant.customerId,
      destinationFingerprint: otherHex,
      fingerprintKeyVersion: 'key_v0',
      programVersion: 'repair_updates_v1',
    })
    const historicalProjectionId = crypto.randomUUID()
    await fixture.client.query(
      `insert into messaging_consent_state (
        id, shop_id, subject_key, customer_id, destination_fingerprint,
        fingerprint_key_version, program_version, status, source_event_id,
        consented_at, retain_until
      ) values (
        $1, $2, $3, $4, $5, $6, 'repair_updates_v1', 'consented', $7,
        now(), now() + interval '5 years'
      )`,
      [historicalProjectionId, tenant.shopId, historicalSubjectKey, tenant.customerId,
        otherHex, 'key_v0', historicalEventId],
    )
    const projectionWorkItemId = crypto.randomUUID()
    await fixture.client.query(
      `insert into messaging_deletion_work_items (
        id, shop_id, request_id, resource_type, resource_id
      ) values ($1, $2, $3, 'consent_projection', $4)`,
      [projectionWorkItemId, tenant.shopId, requestId, historicalProjectionId],
    )
    await fixture.client.query(
      `insert into messaging_deletion_work_items (
        shop_id, request_id, resource_type, resource_id, parent_work_item_id
      ) values ($1, $2, 'consent_event', $3, $4)`,
      [tenant.shopId, requestId, historicalEventId, projectionWorkItemId],
    )

    await fixture.close()
  })

  it('rejects proof-excluded non-consent work items', async () => {
    const fixture = await createTestDb()
    const tenant = await seedOperationalTenant(fixture.client)
    const requestId = await insertDeletionRequest(fixture.client, tenant, {
      subjectKey: tenant.customerId,
    })
    const quoteSendId = await insertQuoteSend(fixture.client, tenant, {
      subjectKey: tenant.customerId,
    })

    await expect(fixture.client.query(
      `insert into messaging_deletion_work_items (
        shop_id, request_id, resource_type, resource_id, counts_toward_proof
      ) values ($1, $2, 'quote_send', $3, false)`,
      [tenant.shopId, requestId, quoteSendId],
    )).rejects.toThrow(/counts_toward_proof/)

    await fixture.close()
  })

  it('permits only protected-field-preserving retained direct-basis swaps', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedOperationalTenant(fixture.client)
      const requestId = await insertDeletionRequest(fixture.client, tenant, {
        subjectKey: tenant.customerId,
      })
      const retainedAt = new Date('2026-07-13T12:00:00.000Z')

      for (const [fromBasis, toBasis] of [
        ['resource_hold', 'subject_hold'],
        ['subject_hold', 'resource_hold'],
      ] as const) {
        const sendId = await insertQuoteSend(fixture.client, tenant, {
          subjectKey: tenant.customerId,
        })
        const workItemId = crypto.randomUUID()
        await fixture.client.query(
          `insert into messaging_deletion_work_items (
            id, shop_id, request_id, resource_type, resource_id
          ) values ($1, $2, $3, 'quote_send', $4)`,
          [workItemId, tenant.shopId, requestId, sendId],
        )
        await fixture.client.query(
          `update messaging_deletion_work_items set outcome = 'retained',
            retention_basis = $1, resolved_at = $2 where id = $3`,
          [fromBasis, retainedAt, workItemId],
        )
        const before = (await fixture.client.query<{
          id: string
          outcome: string
          detached_suppression_sources: number
          resolved_at: Date
        }>(`select id, outcome, detached_suppression_sources, resolved_at
          from messaging_deletion_work_items where id = $1`, [workItemId])).rows[0]!

        await fixture.client.query(
          `update messaging_deletion_work_items set retention_basis = $1 where id = $2`,
          [toBasis, workItemId],
        )
        expect((await fixture.client.query(
          `select id, outcome, retention_basis, detached_suppression_sources, resolved_at
          from messaging_deletion_work_items where id = $1`,
          [workItemId],
        )).rows[0]).toMatchObject({
          ...before,
          retention_basis: toBasis,
        })

        await expect(fixture.client.query(
          `update messaging_deletion_work_items set retention_basis = $1,
            detached_suppression_sources = detached_suppression_sources + 1 where id = $2`,
          [fromBasis, workItemId],
        )).rejects.toThrow(/immutable|transition/)
      }
    } finally {
      await fixture.close()
    }
  })

  it('declares the exact journal columns, indexes, checks, and foreign keys', () => {
    const table = (dbSchema as typeof dbSchema & {
      messagingDeletionWorkItems: Parameters<typeof getTableConfig>[0]
    }).messagingDeletionWorkItems
    const config = getTableConfig(table)

    expect(config.name).toBe('messaging_deletion_work_items')
    expect(Object.keys(getTableColumns(table))).toEqual([
      'id', 'shopId', 'requestId', 'resourceType', 'resourceId',
      'parentWorkItemId', 'outcome', 'retentionBasis', 'countsTowardProof',
      'detachedSuppressionSources', 'discoveredAt', 'resolvedAt',
    ])
    expect(config.indexes.map((index) => index.config.name)).toEqual(expect.arrayContaining([
      'messaging_deletion_work_items_request_resource_uq',
      'messaging_deletion_work_items_request_id_uq',
      'messaging_deletion_work_items_pending_idx',
      'messaging_deletion_work_items_parent_idx',
    ]))
    expect(config.foreignKeys.map((key) => key.getName())).toEqual(expect.arrayContaining([
      'messaging_deletion_work_items_shop_request_fk',
      'messaging_deletion_work_items_parent_fk',
    ]))
    expect(config.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      'messaging_deletion_work_items_resource_type_valid',
      'messaging_deletion_work_items_outcome_valid',
      'messaging_deletion_work_items_retention_basis_valid',
      'messaging_deletion_work_items_state_consistent',
      'messaging_deletion_work_items_detached_count_valid',
    ]))
  })
})

describe('finalizes deletion work journal atomically', () => {
  it('rejects direct completion and deletes the journal only through the finalizer', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedOperationalTenant(fixture.client)
      const requestId = await insertDeletionRequest(fixture.client, tenant, {
        subjectKey: tenant.customerId,
      })
      await insertSuppression(fixture.client, tenant)
      const sendId = await insertQuoteSend(fixture.client, tenant, {
        subjectKey: tenant.customerId,
        state: 'submitted',
        submittingAt: 'now()',
        submittedAt: 'now()',
      })
      const workItemId = crypto.randomUUID()
      await fixture.client.query(
        `insert into messaging_deletion_work_items (
          id, shop_id, request_id, resource_type, resource_id
        ) values ($1, $2, $3, 'quote_send', $4)`,
        [workItemId, tenant.shopId, requestId, sendId],
      )

      await expect(fixture.client.query(
        `update messaging_deletion_requests set
          state = 'completed', customer_id = null,
          completed_at = now(), latest_relevant_at = now(),
          prior_record_counts = '{}'::jsonb, proof_summary = '{}'::jsonb,
          retain_until = now() + interval '5 years'
        where id = $1`,
        [requestId],
      )).rejects.toThrow(/finalizer|pending to completed/)

      await expect(fixture.client.query(
        'delete from messaging_deletion_work_items where id = $1',
        [workItemId],
      )).rejects.toThrow(/finalizer|journal delete/)

      await fixture.client.query('delete from quote_sends where id = $1', [sendId])
      await fixture.client.query(
        `update messaging_deletion_work_items set outcome = 'deleted',
          resolved_at = now() where id = $1`,
        [workItemId],
      )

      const first = (await fixture.client.query<{
        state: string
        prior_record_counts: Record<string, number>
        proof_summary: Record<string, unknown>
      }>(
        'select * from finalize_messaging_deletion_request($1, $2)',
        [tenant.shopId, requestId],
      )).rows[0]
      expect(first).toMatchObject({
        state: 'completed',
        prior_record_counts: {
          consentEvents: 0, consentProjections: 0, notifications: 0,
          quoteSends: 1, smsLogs: 0,
        },
        proof_summary: {
          version: 2, suppressionActive: 1, deletedBarrier: 1,
          resultCounts: { quoteSendsDeleted: 1 },
        },
      })
      expect((await fixture.client.query<{ count: number }>(
        'select count(*)::int as count from messaging_deletion_work_items where request_id = $1',
        [requestId],
      )).rows[0]?.count).toBe(0)

      const retry = (await fixture.client.query(
        'select * from finalize_messaging_deletion_request($1, $2)',
        [tenant.shopId, requestId],
      )).rows[0]
      expect(retry).toEqual(first)
    } finally {
      await fixture.close()
    }
  })

  it.each(['deleted', 'detached'] as const)(
    'rejects a fabricated %s terminal outcome while a readable quote send survives',
    async (outcome) => {
      const fixture = await createTestDb()
      try {
        const tenant = await seedOperationalTenant(fixture.client)
        const requestId = await insertDeletionRequest(fixture.client, tenant, {
          subjectKey: tenant.customerId,
        })
        await insertSuppression(fixture.client, tenant)
        const sendId = await insertQuoteSend(fixture.client, tenant, {
          subjectKey: tenant.customerId,
        })
        const workItemId = crypto.randomUUID()
        await fixture.client.query(
          `insert into messaging_deletion_work_items (
            id, shop_id, request_id, resource_type, resource_id
          ) values ($1, $2, $3, 'quote_send', $4)`,
          [workItemId, tenant.shopId, requestId, sendId],
        )

        await fixture.client.query(
          `update messaging_deletion_work_items set outcome = $1,
            resolved_at = now() where id = $2`,
          [outcome, workItemId],
        )
        await expect(fixture.client.query(
          'select * from finalize_messaging_deletion_request($1, $2)',
          [tenant.shopId, requestId],
        )).rejects.toThrow(/terminal|source|detached/)
        expect((await fixture.client.query(
          'select customer_id, token_hash from quote_sends where id = $1',
          [sendId],
        )).rows[0]).toMatchObject({
          customer_id: tenant.customerId,
          token_hash: expect.any(String),
        })
        expect((await fixture.client.query<{ state: string }>(
          'select state from messaging_deletion_requests where id = $1',
          [requestId],
        )).rows[0]?.state).toBe('pending')
        expect((await fixture.client.query<{ outcome: string }>(
          'select outcome from messaging_deletion_work_items where id = $1',
          [workItemId],
        )).rows[0]?.outcome).toBe(outcome)
      } finally {
        await fixture.close()
      }
    },
  )

  it('accepts an exact lawfully detached quote send and removes its journal in the finalizer', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedOperationalTenant(fixture.client)
      const requestId = await insertDeletionRequest(fixture.client, tenant, {
        subjectKey: tenant.customerId,
      })
      await insertSuppression(fixture.client, tenant)
      const sendId = await insertQuoteSend(fixture.client, tenant, {
        subjectKey: tenant.customerId,
        state: 'submitted',
        submittingAt: 'now()',
        submittedAt: 'now()',
      })
      const workItemId = crypto.randomUUID()
      await fixture.client.query(
        `insert into messaging_deletion_work_items (
          id, shop_id, request_id, resource_type, resource_id
        ) values ($1, $2, $3, 'quote_send', $4)`,
        [workItemId, tenant.shopId, requestId, sendId],
      )
      await fixture.client.query(
        `update quote_sends set customer_id = null, token_hash = null,
          token_expires_at = null where id = $1`,
        [sendId],
      )
      await fixture.client.query(
        `update messaging_deletion_work_items set outcome = 'detached',
          resolved_at = now() where id = $1`,
        [workItemId],
      )

      expect((await fixture.client.query<{ state: string }>(
        'select * from finalize_messaging_deletion_request($1, $2)',
        [tenant.shopId, requestId],
      )).rows[0]?.state).toBe('completed')
      expect((await fixture.client.query<{ count: number }>(
        'select count(*)::int as count from messaging_deletion_work_items where request_id = $1',
        [requestId],
      )).rows[0]?.count).toBe(0)
    } finally {
      await fixture.close()
    }
  })

  it('returns pending for an unjournaled source row or unresolved child', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedOperationalTenant(fixture.client)
      const requestId = await insertDeletionRequest(fixture.client, tenant, {
        subjectKey: tenant.customerId,
      })
      await insertSuppression(fixture.client, tenant)
      const sendId = await insertQuoteSend(fixture.client, tenant, {
        subjectKey: tenant.customerId,
      })

      expect((await fixture.client.query<{ state: string }>(
        'select * from finalize_messaging_deletion_request($1, $2)',
        [tenant.shopId, requestId],
      )).rows[0]?.state).toBe('pending')

      const parentId = crypto.randomUUID()
      await fixture.client.query(
        `insert into messaging_deletion_work_items (
          id, shop_id, request_id, resource_type, resource_id
        ) values ($1, $2, $3, 'quote_send', $4)`,
        [parentId, tenant.shopId, requestId, sendId],
      )
      const smsId = crypto.randomUUID()
      await fixture.client.query(
        `insert into sms_log (
          id, shop_id, quote_send_id, template_key, template_version,
          state, server_received_at, retain_until
        ) values ($1, $2, $3, 'quote_ready', 'v1', 'sent', now(), now() + interval '1 year')`,
        [smsId, tenant.shopId, sendId],
      )
      await fixture.client.query(
        `insert into messaging_deletion_work_items (
          shop_id, request_id, resource_type, resource_id, parent_work_item_id
        ) values ($1, $2, 'sms_log', $3, $4)`,
        [tenant.shopId, requestId, smsId, parentId],
      )

      expect((await fixture.client.query<{ state: string }>(
        'select * from finalize_messaging_deletion_request($1, $2)',
        [tenant.shopId, requestId],
      )).rows[0]?.state).toBe('pending')
    } finally {
      await fixture.close()
    }
  })

  it('returns pending when a retained basis has expired or been released', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedTenant(fixture.client)
      const requestId = await insertDeletionRequest(fixture.client, tenant, {
        subjectKey: tenant.customerId,
      })
      await insertSuppression(fixture.client, tenant)
      const eventId = await insertConsentEvent(fixture.client, tenant, {
        subjectKey: tenant.customerId,
      })
      const workId = crypto.randomUUID()
      await fixture.client.query(
        `insert into messaging_deletion_work_items (
          id, shop_id, request_id, resource_type, resource_id
        ) values ($1, $2, $3, 'consent_event', $4)`,
        [workId, tenant.shopId, requestId, eventId],
      )
      const holdId = await insertHold(fixture.client, tenant, {
        resourceType: 'messaging_consent_event', resourceId: eventId,
      })
      await fixture.client.query(
        `update messaging_deletion_work_items set outcome = 'retained',
          retention_basis = 'resource_hold', resolved_at = now() where id = $1`,
        [workId],
      )
      await fixture.client.query(
        'update messaging_retention_holds set released_at = now() where id = $1',
        [holdId],
      )

      expect((await fixture.client.query<{ state: string }>(
        'select * from finalize_messaging_deletion_request($1, $2)',
        [tenant.shopId, requestId],
      )).rows[0]?.state).toBe('pending')
      expect((await fixture.client.query<{ count: number }>(
        'select count(*)::int as count from messaging_deletion_work_items where request_id = $1',
        [requestId],
      )).rows[0]?.count).toBe(1)
    } finally {
      await fixture.close()
    }
  })

  it('returns pending when a held-dependency chain does not reach a direct hold', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedTenant(fixture.client)
      const requestId = await insertDeletionRequest(fixture.client, tenant, {
        subjectKey: tenant.customerId,
      })
      await insertSuppression(fixture.client, tenant)
      const eventId = await insertConsentEvent(fixture.client, tenant, {
        subjectKey: tenant.customerId,
      })
      const projectionId = crypto.randomUUID()
      await fixture.client.query(
        `insert into messaging_consent_state (
          id, shop_id, subject_key, customer_id, destination_fingerprint,
          fingerprint_key_version, program_version, status, source_event_id,
          revoked_at, retain_until, updated_at
        ) select $1, shop_id, subject_key, customer_id, destination_fingerprint,
          fingerprint_key_version, program_version, 'revoked', id,
          committed_at, retain_until, committed_at
        from messaging_consent_events where id = $2`,
        [projectionId, eventId],
      )
      const parentId = crypto.randomUUID()
      const childId = crypto.randomUUID()
      await fixture.client.query(
        `insert into messaging_deletion_work_items (
          id, shop_id, request_id, resource_type, resource_id
        ) values ($1, $2, $3, 'consent_projection', $4)`,
        [parentId, tenant.shopId, requestId, projectionId],
      )
      await fixture.client.query(
        `insert into messaging_deletion_work_items (
          id, shop_id, request_id, resource_type, resource_id, parent_work_item_id
        ) values ($1, $2, $3, 'consent_event', $4, $5)`,
        [childId, tenant.shopId, requestId, eventId, parentId],
      )
      await fixture.client.query(
        `update messaging_deletion_work_items set outcome = 'retained',
          retention_basis = 'held_dependency', resolved_at = now()
        where id = any($1::uuid[])`,
        [[parentId, childId]],
      )

      expect((await fixture.client.query<{ state: string }>(
        'select * from finalize_messaging_deletion_request($1, $2)',
        [tenant.shopId, requestId],
      )).rows[0]?.state).toBe('pending')
      expect((await fixture.client.query<{ count: number }>(
        'select count(*)::int as count from messaging_deletion_work_items where request_id = $1',
        [requestId],
      )).rows[0]?.count).toBe(2)
    } finally {
      await fixture.close()
    }
  })

  it('publishes retained total as the sum of countable held families', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedTenant(fixture.client)
      const requestId = await insertDeletionRequest(fixture.client, tenant, {
        subjectKey: tenant.customerId,
      })
      await insertSuppression(fixture.client, tenant)
      const eventId = await insertConsentEvent(fixture.client, tenant, {
        subjectKey: tenant.customerId,
        customerId: tenant.customerId,
        programVersion: 'internal_deletion_v1',
        eventType: 'deleted',
        captureMethod: 'staff_request',
        disclosureSnapshot: null,
        disclosureHash: null,
        evidenceKind: 'staff_request',
      })
      const workId = crypto.randomUUID()
      await fixture.client.query(
        `insert into messaging_deletion_work_items (
          id, shop_id, request_id, resource_type, resource_id, counts_toward_proof
        ) values ($1, $2, $3, 'consent_event', $4, false)`,
        [workId, tenant.shopId, requestId, eventId],
      )
      await insertHold(fixture.client, tenant, {
        resourceType: 'messaging_consent_event', resourceId: eventId,
      })
      await fixture.client.query(
        `update messaging_deletion_work_items set outcome = 'retained',
          retention_basis = 'resource_hold', resolved_at = now() where id = $1`,
        [workId],
      )

      const finalized = (await fixture.client.query<{
        state: string
        proof_summary: { retained: Record<string, number> }
      }>('select * from finalize_messaging_deletion_request($1, $2)', [
        tenant.shopId, requestId,
      ])).rows[0]
      expect(finalized).toMatchObject({
        state: 'completed',
        proof_summary: {
          retained: {
            heldConsentEvents: 0, heldConsentProjections: 0, heldQuoteSends: 0,
            heldSmsLogs: 0, heldNotifications: 0, total: 0,
          },
        },
      })
    } finally {
      await fixture.close()
    }
  })

  it('rejects a retained quote-send notification with a fabricated terminal parent', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedOperationalTenant(fixture.client)
      const requestId = await insertDeletionRequest(fixture.client, tenant, {
        subjectKey: tenant.customerId,
      })
      await insertSuppression(fixture.client, tenant)
      const sendId = await insertQuoteSend(fixture.client, tenant, {
        subjectKey: tenant.customerId,
      })
      const notificationId = crypto.randomUUID()
      await fixture.client.query(
        `insert into notifications (
          id, shop_id, recipient_profile_id, event_type, entity_type, entity_id,
          dedupe_key, created_at, retain_until
        ) values ($1, $2, $3, 'quote_sent', 'quote_send', $4, $5, now(),
          now() + interval '90 days')`,
        [notificationId, tenant.shopId, tenant.actorId, sendId, crypto.randomUUID()],
      )
      const parentId = crypto.randomUUID()
      const childId = crypto.randomUUID()
      await fixture.client.query(
        `insert into messaging_deletion_work_items (
          id, shop_id, request_id, resource_type, resource_id
        ) values ($1, $2, $3, 'quote_send', $4)`,
        [parentId, tenant.shopId, requestId, sendId],
      )
      await fixture.client.query(
        `insert into messaging_deletion_work_items (
          id, shop_id, request_id, resource_type, resource_id, parent_work_item_id
        ) values ($1, $2, $3, 'notification', $4, $5)`,
        [childId, tenant.shopId, requestId, notificationId, parentId],
      )
      await insertHold(fixture.client, tenant, {
        resourceType: 'notification', resourceId: notificationId,
      })
      await fixture.client.query(
        `update messaging_deletion_work_items set outcome = case id
            when $1 then 'deleted' else 'retained' end,
          retention_basis = case when id = $2 then 'resource_hold' end,
          resolved_at = now()
        where id = any($3::uuid[])`,
        [parentId, childId, [parentId, childId]],
      )

      await expect(fixture.client.query<{ state: string }>(
        'select * from finalize_messaging_deletion_request($1, $2)',
        [tenant.shopId, requestId],
      )).rejects.toThrow(/deleted terminal|exact source/)
      expect((await fixture.client.query<{ count: number }>(
        'select count(*)::int as count from messaging_deletion_work_items where request_id = $1',
        [requestId],
      )).rows[0]?.count).toBe(2)
    } finally {
      await fixture.close()
    }
  })

  it('rejects a terminal consent parent and completes the exact lawful retained chain', async () => {
    const fixture = await createTestDb()
    try {
      const seedChain = async (
        tenant: Awaited<ReturnType<typeof seedTenant>>,
        parentOutcome: 'deleted' | 'retained',
      ) => {
        const requestId = await insertDeletionRequest(fixture.client, tenant, {
          subjectKey: tenant.customerId,
        })
        await insertSuppression(fixture.client, tenant)
        const eventId = await insertConsentEvent(fixture.client, tenant, {
          subjectKey: tenant.customerId,
        })
        const projectionId = crypto.randomUUID()
        await fixture.client.query(
          `insert into messaging_consent_state (
            id, shop_id, subject_key, customer_id, destination_fingerprint,
            fingerprint_key_version, program_version, status, source_event_id,
            revoked_at, retain_until, updated_at
          ) select $1, shop_id, subject_key, customer_id, destination_fingerprint,
            fingerprint_key_version, program_version, 'revoked', id,
            committed_at, retain_until, committed_at
          from messaging_consent_events where id = $2`,
          [projectionId, eventId],
        )
        const parentId = crypto.randomUUID()
        const childId = crypto.randomUUID()
        await fixture.client.query(
          `insert into messaging_deletion_work_items (
            id, shop_id, request_id, resource_type, resource_id
          ) values ($1, $2, $3, 'consent_projection', $4)`,
          [parentId, tenant.shopId, requestId, projectionId],
        )
        await fixture.client.query(
          `insert into messaging_deletion_work_items (
            id, shop_id, request_id, resource_type, resource_id, parent_work_item_id
          ) values ($1, $2, $3, 'consent_event', $4, $5)`,
          [childId, tenant.shopId, requestId, eventId, parentId],
        )
        await insertHold(fixture.client, tenant, {
          resourceType: 'messaging_consent_event', resourceId: eventId,
        })
        await fixture.client.query(
          `update messaging_deletion_work_items set outcome = $1,
            retention_basis = $2, resolved_at = now() where id = $3`,
          [parentOutcome, parentOutcome === 'retained' ? 'held_dependency' : null, parentId],
        )
        await fixture.client.query(
          `update messaging_deletion_work_items set outcome = 'retained',
            retention_basis = 'resource_hold', resolved_at = now() where id = $1`,
          [childId],
        )
        return requestId
      }

      const terminalTenant = await seedTenant(fixture.client)
      const terminalRequestId = await seedChain(terminalTenant, 'deleted')
      await expect(fixture.client.query<{ state: string }>(
        'select * from finalize_messaging_deletion_request($1, $2)',
        [terminalTenant.shopId, terminalRequestId],
      )).rejects.toThrow(/deleted terminal|exact source/)
      expect((await fixture.client.query<{ count: number }>(
        'select count(*)::int as count from messaging_deletion_work_items where request_id = $1',
        [terminalRequestId],
      )).rows[0]?.count).toBe(2)

      const lawfulTenant = await seedTenant(fixture.client)
      const lawfulRequestId = await seedChain(lawfulTenant, 'retained')
      expect((await fixture.client.query<{
        state: string
        proof_summary: { retained: Record<string, number> }
      }>('select * from finalize_messaging_deletion_request($1, $2)', [
        lawfulTenant.shopId, lawfulRequestId,
      ])).rows[0]).toMatchObject({
        state: 'completed',
        proof_summary: {
          retained: { heldConsentEvents: 1, heldConsentProjections: 1, total: 2 },
        },
      })
    } finally {
      await fixture.close()
    }
  })
})

describe('Shop OS messaging retention source schema', () => {
  it('declares correctly ordered covering indexes for every Row 31 foreign key', () => {
    const indexNames = [
      messagingConsentEvents,
      messagingConsentState,
      smsSuppressions,
      messagingDeletionWorkItems,
      messagingRetentionHolds,
      quoteSends,
    ].flatMap((table) => getTableConfig(table).indexes.map((index) => index.config.name))

    expect(indexNames).toEqual(expect.arrayContaining([
      'messaging_consent_events_shop_customer_idx',
      'messaging_consent_state_shop_customer_idx',
      'messaging_consent_state_shop_source_event_idx',
      'messaging_deletion_work_items_parent_work_item_idx',
      'messaging_deletion_work_items_shop_request_idx',
      'messaging_retention_holds_shop_actor_idx',
      'quote_sends_shop_customer_idx',
      'sms_suppressions_shop_source_event_idx',
    ]))
  })

  it('applies the exact foreign-key covering indexes through the standard fixture', async () => {
    const fixture = await createTestDb()
    try {
      const result = await fixture.client.query<{ indexname: string; indexdef: string }>(`
        select indexname, indexdef
        from pg_indexes
        where schemaname = 'public'
          and indexname in (
            'messaging_consent_events_shop_customer_idx',
            'messaging_consent_state_shop_customer_idx',
            'messaging_consent_state_shop_source_event_idx',
            'messaging_deletion_work_items_parent_work_item_idx',
            'messaging_deletion_work_items_shop_request_idx',
            'messaging_retention_holds_shop_actor_idx',
            'quote_sends_shop_customer_idx',
            'sms_suppressions_shop_source_event_idx'
          )
      `)
      const definitions = Object.fromEntries(
        result.rows.map((row) => [row.indexname, row.indexdef.replace(/\s+/g, ' ')]),
      )

      expect(definitions).toMatchObject({
        messaging_consent_events_shop_customer_idx: expect.stringContaining('(shop_id, customer_id)'),
        messaging_consent_state_shop_customer_idx: expect.stringContaining('(shop_id, customer_id)'),
        messaging_consent_state_shop_source_event_idx: expect.stringContaining('(shop_id, source_event_id)'),
        messaging_deletion_work_items_parent_work_item_idx: expect.stringContaining('(parent_work_item_id)'),
        messaging_deletion_work_items_shop_request_idx: expect.stringContaining('(shop_id, request_id)'),
        messaging_retention_holds_shop_actor_idx: expect.stringContaining('(shop_id, authorizing_actor_profile_id)'),
        quote_sends_shop_customer_idx: expect.stringContaining('(shop_id, customer_id)'),
        sms_suppressions_shop_source_event_idx: expect.stringContaining('(shop_id, source_event_id)'),
      })
      expect(Object.keys(definitions)).toHaveLength(8)
    } finally {
      await fixture.close()
    }
  })

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
    expect(getTableColumns(messagingDeletionRequests)).toMatchObject({
      latestRelevantAt: expect.anything(),
    })
  })

  it('declares detachable sends and a historical quote-event send identifier', () => {
    expect([quoteSends, smsLog, notifications].map((table) => getTableConfig(table).name))
      .toEqual(['quote_sends', 'sms_log', 'notifications'])
    expect(getTableConfig(quoteEvents).foreignKeys.map((key) => key.getName()))
      .not.toContain('quote_events_shop_ticket_send_fk')
    expect(getTableColumns(quoteSends)).toMatchObject({
      shopId: expect.anything(),
      ticketId: expect.anything(),
      quoteVersionId: expect.anything(),
      customerId: expect.anything(),
      subjectKey: expect.anything(),
      destinationFingerprint: expect.anything(),
      fingerprintKeyVersion: expect.anything(),
      channel: expect.anything(),
      tokenHash: expect.anything(),
      tokenExpiresAt: expect.anything(),
      requestingActorProfileId: expect.anything(),
      requestKey: expect.anything(),
      requestFingerprint: expect.anything(),
      state: expect.anything(),
      submittingAt: expect.anything(),
      submittedAt: expect.anything(),
      terminalAt: expect.anything(),
      retainUntil: expect.anything(),
    })
    expect(getTableColumns(quoteSends).customerId.notNull).toBe(false)
    expect(getTableColumns(quoteSends).subjectKey.notNull).toBe(true)
    expect(getTableColumns(smsLog)).toMatchObject({
      shopId: expect.anything(),
      quoteSendId: expect.anything(),
      providerMessageId: expect.anything(),
      providerEventId: expect.anything(),
      templateKey: expect.anything(),
      templateVersion: expect.anything(),
      state: expect.anything(),
      errorCode: expect.anything(),
      providerOccurredAt: expect.anything(),
      serverReceivedAt: expect.anything(),
      retainUntil: expect.anything(),
    })
    expect(getTableColumns(notifications)).toMatchObject({
      shopId: expect.anything(),
      recipientProfileId: expect.anything(),
      eventType: expect.anything(),
      entityType: expect.anything(),
      entityId: expect.anything(),
      dedupeKey: expect.anything(),
      createdAt: expect.anything(),
      readAt: expect.anything(),
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
            'messaging_deletion_requests', 'messaging_retention_holds', 'quote_sends',
            'sms_log', 'notifications'
          )
      `)
      expect(result.rows[0]?.count).toBe(8)
    } finally {
      await fixture.close()
    }
  })

  it('validates exact live quote-send identity when a quote event is inserted', async () => {
    const fixture = await createTestDb()
    try {
      const first = await seedOperationalTenant(fixture.client)
      const second = await seedOperationalTenant(fixture.client)
      await expect(insertQuoteSend(fixture.client, first, {
        ticketId: second.ticketId,
      })).rejects.toThrow(/quote_sends_shop_ticket_fk/)
      await expect(insertQuoteSend(fixture.client, first, {
        customerId: second.customerId,
      })).rejects.toThrow(/quote_sends_shop_customer_fk/)
      await expect(insertQuoteSend(fixture.client, first, {
        quoteVersionId: second.quoteVersionId,
      })).rejects.toThrow(/quote_sends_shop_ticket_version_fk/)
      await expect(insertQuoteSend(fixture.client, first, {
        actorId: second.actorId,
      })).rejects.toThrow(/quote_sends_shop_actor_fk/)

      const sendId = await insertQuoteSend(fixture.client, first)
      await expect(fixture.client.query(
        `insert into sms_log (
          shop_id, quote_send_id, template_key, template_version, state,
          server_received_at, retain_until
        ) values ($1, $2, 'quote_ready', 'v1', 'accepted', now(), now() + interval '1 year')`,
        [second.shopId, sendId],
      )).rejects.toThrow(/sms_log_shop_send_fk/)
      await expect(fixture.client.query(
        `insert into notifications (
          shop_id, recipient_profile_id, event_type, entity_type,
          entity_id, dedupe_key, retain_until
        ) values ($1, $2, 'quote_ready', 'quote_send', $3, 'dedupe_1', now() + interval '90 days')`,
        [first.shopId, second.actorId, sendId],
      )).rejects.toThrow(/notifications_shop_recipient_fk/)
      await expect(fixture.client.query(
        `insert into quote_events (
          shop_id, ticket_id, quote_version_id, quote_send_id, kind, request_key
        ) values ($1, $2, $3, $4, 'sent', $5)`,
        [second.shopId, second.ticketId, second.quoteVersionId, sendId, crypto.randomUUID()],
      )).rejects.toThrow(/quote event send reference must match an exact live quote send/)

      const secondVersionId = crypto.randomUUID()
      await fixture.client.query(
        `insert into quote_versions (
          id, shop_id, ticket_id, version_number, snapshot, created_by_profile_id
        ) values ($1, $2, $3, 2, '{}'::jsonb, $4)`,
        [secondVersionId, first.shopId, first.ticketId, first.actorId],
      )
      await expect(fixture.client.query(
        `insert into quote_events (
          shop_id, ticket_id, quote_version_id, quote_send_id, kind, request_key
        ) values ($1, $2, $3, $4, 'sent', $5)`,
        [first.shopId, first.ticketId, secondVersionId, sendId, crypto.randomUUID()],
      )).rejects.toThrow(/quote event send reference must match an exact live quote send/)

      await fixture.client.exec('set role service_role')
      try {
        await expect(fixture.client.query(
          `insert into quote_events (
            shop_id, ticket_id, quote_version_id, quote_send_id, kind, request_key
          ) values ($1, $2, $3, $4, 'sent', $5)`,
          [first.shopId, first.ticketId, first.quoteVersionId, sendId, crypto.randomUUID()],
        )).resolves.toBeDefined()
      } finally {
        await fixture.client.exec('reset role')
      }
    } finally {
      await fixture.close()
    }
  })

  it('deletes a referenced quote send without changing its historical quote event', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedOperationalTenant(fixture.client)
      const sendId = await insertQuoteSend(fixture.client, tenant)
      const eventId = crypto.randomUUID()
      await fixture.client.query(
        `insert into quote_events (
          id, shop_id, ticket_id, quote_version_id, quote_send_id, kind, request_key
        ) values ($1, $2, $3, $4, $5, 'sent', $6)`,
        [eventId, tenant.shopId, tenant.ticketId, tenant.quoteVersionId, sendId,
          crypto.randomUUID()],
      )
      const before = await fixture.client.query<{ snapshot: string }>(
        'select to_jsonb(quote_events)::text as snapshot from quote_events where id = $1',
        [eventId],
      )

      await fixture.client.query('delete from quote_sends where id = $1', [sendId])

      const after = await fixture.client.query<{ snapshot: string }>(
        'select to_jsonb(quote_events)::text as snapshot from quote_events where id = $1',
        [eventId],
      )
      expect(after.rows[0]?.snapshot).toBe(before.rows[0]?.snapshot)
      expect(JSON.parse(after.rows[0]!.snapshot).quote_send_id).toBe(sendId)
    } finally {
      await fixture.close()
    }
  })

  it('requires a matching pending deletion request before identity or token detachment', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedOperationalTenant(fixture.client)
      const sendId = await insertQuoteSend(fixture.client, tenant, {
        state: 'submitting',
        submittingAt: 'now()',
      })
      await expect(fixture.client.query(
        'update quote_sends set customer_id = null where id = $1',
        [sendId],
      )).rejects.toThrow(/matching pending messaging deletion request/)
      await expect(fixture.client.query(
        'update quote_sends set token_hash = null, token_expires_at = null where id = $1',
        [sendId],
      )).rejects.toThrow(/matching pending messaging deletion request/)

      const otherCustomerId = crypto.randomUUID()
      await fixture.client.query(
        'insert into customers (id, shop_id, name, phone) values ($1, $2, $3, $4)',
        [otherCustomerId, tenant.shopId, 'Other Schema Customer', '+15550000001'],
      )
      await insertDeletionRequest(fixture.client, {
        ...tenant,
        customerId: otherCustomerId,
      }, { subjectKey: crypto.randomUUID() })
      await expect(fixture.client.query(
        `update quote_sends
        set customer_id = null, token_hash = null, token_expires_at = null
        where id = $1`,
        [sendId],
      )).rejects.toThrow(/matching pending messaging deletion request/)
    } finally {
      await fixture.close()
    }
  })

  it('authorizes a held legacy-key send from one current-key request and its exact deletion barrier', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedOperationalTenant(fixture.client)
      await insertDeletionRequest(fixture.client, tenant, {
        subjectKey: crypto.randomUUID(),
        destinationFingerprint: otherHex,
        fingerprintKeyVersion: 'key_v2',
      })
      await insertSuppression(fixture.client, tenant, {
        destinationFingerprint: hex,
        fingerprintKeyVersion: 'key_v1',
      })
      const sendId = await insertQuoteSend(fixture.client, tenant, {
        state: 'submitted',
        submittingAt: 'now()',
        submittedAt: 'now()',
      })

      await expect(fixture.client.query(
        `update quote_sends
        set customer_id = null, token_hash = null, token_expires_at = null
        where id = $1`,
        [sendId],
      )).resolves.toBeDefined()
    } finally {
      await fixture.close()
    }
  })

  it.each(['verified_deletion', 'permanent_failure', 'number_reassigned'])(
    'accepts the exact current-key non-liftable %s barrier',
    async (reason) => {
      const fixture = await createTestDb()
      try {
        const tenant = await seedOperationalTenant(fixture.client)
        await insertDeletionRequest(fixture.client, tenant, { subjectKey: crypto.randomUUID() })
        await insertSuppression(fixture.client, tenant, { reason })
        const sendId = await insertQuoteSend(fixture.client, tenant, {
          state: 'submitted', submittingAt: 'now()', submittedAt: 'now()',
        })
        await expect(fixture.client.query(
          'update quote_sends set customer_id = null where id = $1',
          [sendId],
        )).resolves.toBeDefined()
      } finally {
        await fixture.close()
      }
    },
  )

  it.each([
    ['missing', {}],
    ['customer revocation', { reason: 'customer_revocation' }],
    ['lifted', { liftedAt: 'now()' }],
    ['short retention', { retainUntil: "now() + interval '5 years' - interval '1 second'" }],
    ['fingerprint mismatch', { destinationFingerprint: otherHex }],
    ['key-version mismatch', { fingerprintKeyVersion: 'key_v2' }],
  ] as const)('rejects a %s suppression as deletion authorization', async (variant, suppression) => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedOperationalTenant(fixture.client)
      await insertDeletionRequest(fixture.client, tenant, { subjectKey: crypto.randomUUID() })
      if (variant !== 'missing') await insertSuppression(fixture.client, tenant, suppression)
      const sendId = await insertQuoteSend(fixture.client, tenant, {
        state: 'submitted', submittingAt: 'now()', submittedAt: 'now()',
      })

      await expect(fixture.client.query(
        'update quote_sends set customer_id = null where id = $1',
        [sendId],
      )).rejects.toThrow(/matching pending messaging deletion request/)
    } finally {
      await fixture.close()
    }
  })

  it('rejects completed, unrelated-customer, and unrelated-shop deletion authorization', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedOperationalTenant(fixture.client)
      const other = await seedOperationalTenant(fixture.client)
      const otherCustomerId = crypto.randomUUID()
      await fixture.client.query(
        'insert into customers (id, shop_id, name, phone) values ($1, $2, $3, $4)',
        [otherCustomerId, tenant.shopId, 'Unrelated Customer', '+15550000002'],
      )
      await insertDeletionRequest(fixture.client, tenant, {
        subjectKey: crypto.randomUUID(), state: 'completed',
      })
      await insertDeletionRequest(fixture.client, {
        ...tenant, customerId: otherCustomerId,
      }, { subjectKey: crypto.randomUUID() })
      await insertSuppression(fixture.client, other)
      const sendId = await insertQuoteSend(fixture.client, tenant, {
        state: 'submitted', submittingAt: 'now()', submittedAt: 'now()',
      })

      await expect(fixture.client.query(
        'update quote_sends set customer_id = null where id = $1',
        [sendId],
      )).rejects.toThrow(/matching pending messaging deletion request/)
    } finally {
      await fixture.close()
    }
  })

  it.each(['submitting', 'submitted', 'delivered'] as const)(
    'allows authorized atomic identity and token detachment for %s sends',
    async (state) => {
      const fixture = await createTestDb()
      try {
        const tenant = await seedOperationalTenant(fixture.client)
        await insertDeletionRequest(fixture.client, tenant, { subjectKey: crypto.randomUUID() })
        await insertSuppression(fixture.client, tenant)
        const sendId = await insertQuoteSend(fixture.client, tenant, {
          state,
          submittingAt: 'now()',
          submittedAt: state === 'submitting' ? null : 'now()',
        })

        await fixture.client.query(
          `update quote_sends
          set customer_id = null, token_hash = null, token_expires_at = null
          where id = $1`,
          [sendId],
        )
        expect((await fixture.client.query<{
          customer_id: string | null
          token_hash: string | null
          token_expires_at: Date | null
          state: string
        }>(
          `select customer_id, token_hash, token_expires_at, state
          from quote_sends where id = $1`,
          [sendId],
        )).rows[0]).toEqual({
          customer_id: null,
          token_hash: null,
          token_expires_at: null,
          state,
        })
      } finally {
        await fixture.close()
      }
    },
  )

  it('allows authorized detachment and token revocation independently', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedOperationalTenant(fixture.client)
      await insertDeletionRequest(fixture.client, tenant, { subjectKey: crypto.randomUUID() })
      await insertSuppression(fixture.client, tenant)
      const detachedId = await insertQuoteSend(fixture.client, tenant, {
        state: 'submitting',
        submittingAt: 'now()',
      })
      const revokedId = await insertQuoteSend(fixture.client, tenant, {
        state: 'submitted',
        submittingAt: 'now()',
        submittedAt: 'now()',
      })

      await fixture.client.query(
        'update quote_sends set customer_id = null where id = $1',
        [detachedId],
      )
      await fixture.client.query(
        'update quote_sends set token_hash = null, token_expires_at = null where id = $1',
        [revokedId],
      )

      expect((await fixture.client.query<{
        customer_id: string | null
        token_hash: string | null
      }>(
        'select customer_id, token_hash from quote_sends where id = $1',
        [detachedId],
      )).rows[0]).toEqual({ customer_id: null, token_hash: hex })
      expect((await fixture.client.query<{
        customer_id: string | null
        token_hash: string | null
      }>(
        'select customer_id, token_hash from quote_sends where id = $1',
        [revokedId],
      )).rows[0]).toEqual({ customer_id: tenant.customerId, token_hash: null })
    } finally {
      await fixture.close()
    }
  })

  it('uses the canonical pending deletion request before send mutation', async () => {
    const fixture = await createTestDb()
    try {
      const functionProof = await fixture.client.query<{ function_definition: string }>(`
        select pg_get_functiondef(
          'guard_quote_send_lifecycle()'::regprocedure
        ) as function_definition
      `)
      const functionDefinition = functionProof.rows[0]!.function_definition.toLowerCase()
      expect(functionDefinition).not.toContain('select exists')
      expect(functionDefinition).toContain('select deletion_request.id, deletion_request.requested_at')
      expect(functionDefinition).toContain('and deletion_request.customer_id = old.customer_id')
      expect(functionDefinition).toContain("and deletion_request.state = 'pending'")
      expect(functionDefinition).toContain('for share')
      expect(functionDefinition).not.toContain('for locked_request_id, locked_request_requested_at in')
      expect(functionDefinition).toContain('order by suppression.id')

      const tenant = await seedOperationalTenant(fixture.client)
      await insertDeletionRequest(fixture.client, tenant, { subjectKey: crypto.randomUUID() })
      await insertSuppression(fixture.client, tenant)
      const sendId = await insertQuoteSend(fixture.client, tenant, {
        state: 'submitted',
        submittingAt: 'now()',
        submittedAt: 'now()',
      })
      await expect(fixture.client.query(
        `update quote_sends
        set customer_id = null, token_hash = null, token_expires_at = null
        where id = $1`,
        [sendId],
      )).resolves.toBeDefined()
    } finally {
      await fixture.close()
    }
  })

  it('never restores or reassigns detached customer identity or revoked tokens', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedOperationalTenant(fixture.client)
      const other = await seedTenant(fixture.client)
      await fixture.client.query(
        'update customers set shop_id = $1 where id = $2',
        [tenant.shopId, other.customerId],
      )
      await insertDeletionRequest(fixture.client, tenant, { subjectKey: crypto.randomUUID() })
      await insertSuppression(fixture.client, tenant)
      const sendId = await insertQuoteSend(fixture.client, tenant, {
        state: 'submitted',
        submittingAt: 'now()',
        submittedAt: 'now()',
      })
      await fixture.client.query(
        `update quote_sends
        set customer_id = null, token_hash = null, token_expires_at = null
        where id = $1`,
        [sendId],
      )

      await expect(fixture.client.query(
        'update quote_sends set customer_id = $1 where id = $2',
        [tenant.customerId, sendId],
      )).rejects.toThrow(/detached quote send customer cannot be restored or reassigned/)
      await expect(fixture.client.query(
        'update quote_sends set customer_id = $1 where id = $2',
        [other.customerId, sendId],
      )).rejects.toThrow(/detached quote send customer cannot be restored or reassigned/)
      await expect(fixture.client.query(
        `update quote_sends set token_hash = $1,
          token_expires_at = now() + interval '1 day' where id = $2`,
        [otherHex, sendId],
      )).rejects.toThrow(/revoked quote send token cannot be restored or reassigned/)
      await expect(fixture.client.query(
        'update quote_sends set subject_key = $1 where id = $2',
        [crypto.randomUUID(), sendId],
      )).rejects.toThrow(/quote send subject identity is immutable/)
    } finally {
      await fixture.close()
    }
  })

  it('permits only authorized customer detachment on a terminal held send', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedOperationalTenant(fixture.client)
      await insertDeletionRequest(fixture.client, tenant, { subjectKey: crypto.randomUUID() })
      await insertSuppression(fixture.client, tenant)
      const sendId = await insertQuoteSend(fixture.client, tenant, {
        state: 'responded',
        tokenHash: null,
        tokenExpiresAt: null,
        submittingAt: 'now()',
        submittedAt: 'now()',
        terminalAt: 'now()',
        retainUntil: "now() + interval '1 year'",
      })
      await insertHold(fixture.client, tenant, { resourceType: 'quote_send', resourceId: sendId })

      await fixture.client.query('update quote_sends set customer_id = null where id = $1', [sendId])
      await expect(fixture.client.query(
        "update quote_sends set updated_at = now() + interval '1 second' where id = $1",
        [sendId],
      )).rejects.toThrow(/terminal quote sends are immutable/)
    } finally {
      await fixture.close()
    }
  })

  it('rejects unsafe operation payloads, invalid states, and inconsistent timestamps', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedOperationalTenant(fixture.client)
      await expect(insertQuoteSend(fixture.client, tenant, {
        tokenHash: 'raw-token',
      })).rejects.toThrow(/quote_sends_token_hash_valid/)
      await expect(insertQuoteSend(fixture.client, tenant, {
        tokenHash: 'a'.repeat(65),
      })).rejects.toThrow(/quote_sends_token_hash_valid/)
      await expect(insertQuoteSend(fixture.client, tenant, {
        state: 'sent_later',
      })).rejects.toThrow(/quote_sends_state_valid/)
      await expect(insertQuoteSend(fixture.client, tenant, {
        state: 'submitted',
      })).rejects.toThrow(/quote_sends_submission_timestamps_consistent/)
      await expect(insertQuoteSend(fixture.client, tenant, {
        tokenExpiresAt: 'now()',
      })).rejects.toThrow(/quote_sends_token_action_consistent/)
      await expect(insertQuoteSend(fixture.client, tenant, {
        state: 'cancelled',
        tokenHash: null,
        tokenExpiresAt: null,
        terminalAt: 'now()',
        retainUntil: "now() - interval '1 second'",
      })).rejects.toThrow(/quote_sends_retention_timestamp_valid/)
      await expect(insertQuoteSend(fixture.client, tenant, {
        state: 'cancelled',
        tokenHash: null,
        tokenExpiresAt: null,
        createdAt: "'2024-03-01 12:00:00+00'",
        terminalAt: "'2024-03-01 11:59:59+00'",
        retainUntil: "'2025-03-01 11:59:59+00'",
      })).rejects.toThrow(/quote_sends_retention_timestamp_valid/)
      await expect(insertQuoteSend(fixture.client, tenant, {
        state: 'responded',
        tokenHash: null,
        tokenExpiresAt: null,
        createdAt: "'2024-03-01 12:00:00+00'",
        submittingAt: "'2024-03-01 12:01:00+00'",
        submittedAt: "'2024-03-01 12:02:00+00'",
        terminalAt: "'2024-03-01 12:01:30+00'",
        retainUntil: "'2025-03-01 12:01:30+00'",
      })).rejects.toThrow(/quote_sends_retention_timestamp_valid/)

      const sendId = await insertQuoteSend(fixture.client, tenant)
      await expect(fixture.client.query(
        `insert into sms_log (
          shop_id, quote_send_id, provider_message_id, template_key,
          template_version, state, server_received_at, retain_until
        ) values ($1, $2, $3, 'quote_ready', 'v1', 'accepted', now(), now() + interval '1 year')`,
        [tenant.shopId, sendId, 'x'.repeat(257)],
      )).rejects.toThrow(/sms_log_provider_message_id_valid/)
      await expect(fixture.client.query(
        `insert into sms_log (
          shop_id, quote_send_id, provider_event_id, template_key,
          template_version, state, server_received_at, retain_until
        ) values ($1, $2, $3, 'quote_ready', 'v1', 'accepted', now(), now() + interval '1 year')`,
        [tenant.shopId, sendId, 'x'.repeat(257)],
      )).rejects.toThrow(/sms_log_provider_event_id_valid/)
      await expect(fixture.client.query(
        `insert into sms_log (
          shop_id, quote_send_id, template_key, template_version, state,
          server_received_at, retain_until
        ) values ($1, $2, $3, 'v1', 'accepted', now(), now() + interval '1 year')`,
        [tenant.shopId, sendId, 'x'.repeat(65)],
      )).rejects.toThrow(/sms_log_template_key_valid/)
      await expect(fixture.client.query(
        `insert into sms_log (
          shop_id, quote_send_id, template_key, template_version, state,
          error_code, server_received_at, retain_until
        ) values ($1, $2, 'quote_ready', 'v1', 'accepted', $3, now(), now() + interval '1 year')`,
        [tenant.shopId, sendId, 'x'.repeat(129)],
      )).rejects.toThrow(/sms_log_error_code_valid/)
      await expect(fixture.client.query(
        `insert into sms_log (
          shop_id, quote_send_id, template_key, template_version, state,
          server_received_at, retain_until
        ) values ($1, $2, 'quote_ready', 'v1', 'unknown', now(), now() + interval '1 year')`,
        [tenant.shopId, sendId],
      )).rejects.toThrow(/sms_log_state_valid/)
      await expect(fixture.client.query(
        `insert into notifications (
          shop_id, recipient_profile_id, event_type, entity_type,
          entity_id, dedupe_key, created_at, read_at, retain_until
        ) values ($1, $2, 'quote_ready', 'quote_send', $3, 'dedupe_2',
          now(), now() - interval '1 second', now() + interval '90 days')`,
        [tenant.shopId, tenant.actorId, sendId],
      )).rejects.toThrow(/notifications_read_at_valid/)
    } finally {
      await fixture.close()
    }
  })

  it('enforces exact calendar retention windows at leap and clock edges', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedOperationalTenant(fixture.client)
      const leapStart = "'2024-02-29 12:00:00+00'"
      await insertQuoteSend(fixture.client, tenant, {
        state: 'cancelled',
        tokenHash: null,
        tokenExpiresAt: null,
        createdAt: leapStart,
        terminalAt: leapStart,
        retainUntil: "'2025-02-28 12:00:00+00'",
      })
      for (const retainUntil of [
        "'2025-02-28 11:59:59+00'",
        "'2025-02-28 12:00:01+00'",
      ]) {
        await expect(insertQuoteSend(fixture.client, tenant, {
          state: 'cancelled',
          tokenHash: null,
          tokenExpiresAt: null,
          createdAt: leapStart,
          terminalAt: leapStart,
          retainUntil,
        })).rejects.toThrow(/quote_sends_retention_timestamp_valid/)
      }

      const sendId = await insertQuoteSend(fixture.client, tenant)
      await fixture.client.query(
        `insert into sms_log (
          shop_id, quote_send_id, template_key, template_version, state,
          server_received_at, retain_until
        ) values ($1, $2, 'quote_ready', 'v1', 'delivered',
          '2024-02-29 12:00:00+00', '2025-02-28 12:00:00+00')`,
        [tenant.shopId, sendId],
      )
      for (const retainUntil of [
        '2025-02-28 11:59:59+00',
        '2025-02-28 12:00:01+00',
      ]) {
        await expect(fixture.client.query(
          `insert into sms_log (
            shop_id, quote_send_id, template_key, template_version, state,
            server_received_at, retain_until
          ) values ($1, $2, 'quote_ready', 'v1', 'delivered',
            '2024-02-29 12:00:00+00', $3)`,
          [tenant.shopId, sendId, retainUntil],
        )).rejects.toThrow(/sms_log_retention_timestamp_valid/)
      }

      await fixture.client.query(
        `insert into notifications (
          shop_id, recipient_profile_id, event_type, entity_type,
          entity_id, dedupe_key, created_at, retain_until
        ) values ($1, $2, 'quote_ready', 'quote_send', $3, 'retention_exact',
          '2024-01-31 12:00:00+00', '2024-04-30 12:00:00+00')`,
        [tenant.shopId, tenant.actorId, sendId],
      )
      for (const [dedupeKey, retainUntil] of [
        ['retention_early', '2024-04-30 11:59:59+00'],
        ['retention_late', '2024-04-30 12:00:01+00'],
      ]) {
        await expect(fixture.client.query(
          `insert into notifications (
            shop_id, recipient_profile_id, event_type, entity_type,
            entity_id, dedupe_key, created_at, retain_until
          ) values ($1, $2, 'quote_ready', 'quote_send', $3, $4,
            '2024-01-31 12:00:00+00', $5)`,
          [tenant.shopId, tenant.actorId, sendId, dedupeKey, retainUntil],
        )).rejects.toThrow(/notifications_retention_timestamp_valid/)
      }
    } finally {
      await fixture.close()
    }
  })

  it('enforces the explicit forward-only quote-send lifecycle and terminal immutability', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedOperationalTenant(fixture.client)
      const sendId = await insertQuoteSend(fixture.client, tenant)
      await fixture.client.query("update quote_sends set state = 'claimed' where id = $1", [sendId])
      await fixture.client.query(
        "update quote_sends set state = 'submitting', submitting_at = now() where id = $1",
        [sendId],
      )
      await fixture.client.query(
        "update quote_sends set state = 'submitted', submitted_at = now() where id = $1",
        [sendId],
      )
      await fixture.client.query("update quote_sends set state = 'delivered' where id = $1", [sendId])
      await fixture.client.query(
        `update quote_sends set state = 'responded', token_hash = null,
          token_expires_at = null, terminal_at = now(), retain_until = now() + interval '1 year'
        where id = $1`,
        [sendId],
      )
      await expect(fixture.client.query(
        "update quote_sends set updated_at = now() + interval '1 second' where id = $1",
        [sendId],
      )).rejects.toThrow(/terminal quote sends are immutable/)

      const skippedId = await insertQuoteSend(fixture.client, tenant)
      await expect(fixture.client.query(
        `update quote_sends set state = 'submitted', submitting_at = now(), submitted_at = now()
        where id = $1`,
        [skippedId],
      )).rejects.toThrow(/invalid quote send state transition/)

      const manufacturedId = await insertQuoteSend(fixture.client, tenant)
      await expect(fixture.client.query(
        `update quote_sends set state = 'expired', token_hash = null,
          token_expires_at = null, submitting_at = now(), submitted_at = now(),
          terminal_at = now(), retain_until = now() + interval '1 year'
        where id = $1`,
        [manufacturedId],
      )).rejects.toThrow(/cannot manufacture submission anchors/)

      const sameStateId = await insertQuoteSend(fixture.client, tenant)
      await fixture.client.query(
        "update quote_sends set updated_at = now() + interval '1 second' where id = $1",
        [sameStateId],
      )
      await expect(fixture.client.query(
        `update quote_sends set request_fingerprint = $1 where id = $2`,
        ['c'.repeat(64), sameStateId],
      )).rejects.toThrow(/same-state quote send updates may only change updated_at/)

      const reactivatedId = await insertQuoteSend(fixture.client, tenant, {
        state: 'cancelled',
        tokenHash: null,
        tokenExpiresAt: null,
        terminalAt: 'now()',
        retainUntil: "now() + interval '1 year'",
      })
      await expect(fixture.client.query(
        `update quote_sends set state = 'queued', token_hash = $1,
          token_expires_at = now() + interval '1 day', terminal_at = null, retain_until = null
        where id = $2`,
        [hex, reactivatedId],
      )).rejects.toThrow(/terminal quote sends are immutable/)
    } finally {
      await fixture.close()
    }
  })

  it('allows every alternate terminal edge in the quote-send lifecycle graph', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedOperationalTenant(fixture.client)
      const cases = [
        ['queued', 'cancelled', null, null],
        ['queued', 'expired', null, null],
        ['claimed', 'cancelled', null, null],
        ['claimed', 'expired', null, null],
        ['submitting', 'failed', 'now()', null],
        ['submitted', 'failed', 'now()', 'now()'],
        ['submitted', 'responded', 'now()', 'now()'],
        ['submitted', 'expired', 'now()', 'now()'],
        ['delivered', 'responded', 'now()', 'now()'],
        ['delivered', 'expired', 'now()', 'now()'],
      ] as const
      for (const [from, to, submittingAt, submittedAt] of cases) {
        const id = await insertQuoteSend(fixture.client, tenant, {
          state: from,
          submittingAt,
          submittedAt,
        })
        await expect(fixture.client.query(
          `update quote_sends set state = $1, token_hash = null, token_expires_at = null,
            terminal_at = now(), retain_until = now() + interval '1 year'
          where id = $2`,
          [to, id],
        )).resolves.toBeDefined()
      }
    } finally {
      await fixture.close()
    }
  })

  it('refuses an operation-table constraint removed from the guarded fixture', async () => {
    const fixture = await createTestDb()
    try {
      await fixture.client.exec(
        'alter table notifications drop constraint notifications_read_at_valid',
      )
      await expect(ensureMessagingRetentionMigration(fixture.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
    } finally {
      await fixture.close()
    }
  })

  it('refuses missing or rebound quote-event validator triggers', async () => {
    const missingTrigger = await createTestDb()
    try {
      await missingTrigger.client.exec(
        'drop trigger quote_events_send_reference_validator on quote_events',
      )
      await expect(ensureMessagingRetentionMigration(missingTrigger.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
    } finally {
      await missingTrigger.close()
    }

    const reboundTrigger = await createTestDb()
    try {
      await reboundTrigger.client.exec(`
        drop trigger quote_events_send_reference_validator on quote_events;
        create trigger quote_events_send_reference_validator
        before insert on quote_events
        for each row execute function guard_quote_send_lifecycle();
      `)
      await expect(ensureMessagingRetentionMigration(reboundTrigger.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
    } finally {
      await reboundTrigger.close()
    }
  })

  it('refuses unsafe validator execution, search path, customer nullability, or lifecycle body', async () => {
    const unsafeExecute = await createTestDb()
    try {
      await unsafeExecute.client.exec(
        'grant execute on function validate_quote_event_send_reference() to public',
      )
      await expect(ensureMessagingRetentionMigration(unsafeExecute.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
    } finally {
      await unsafeExecute.close()
    }

    const unsafeSearchPath = await createTestDb()
    try {
      await unsafeSearchPath.client.exec(
        'alter function validate_quote_event_send_reference() set search_path = public',
      )
      await expect(ensureMessagingRetentionMigration(unsafeSearchPath.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
    } finally {
      await unsafeSearchPath.close()
    }

    const nonNullCustomer = await createTestDb()
    try {
      await nonNullCustomer.client.exec(
        'alter table quote_sends alter column customer_id set not null',
      )
      await expect(ensureMessagingRetentionMigration(nonNullCustomer.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
    } finally {
      await nonNullCustomer.close()
    }

    const weakenedLifecycle = await createTestDb()
    try {
      await weakenedLifecycle.client.exec(`
        create or replace function guard_quote_send_lifecycle()
        returns trigger
        language plpgsql
        set search_path = ''
        as $$ begin return new; end $$;
      `)
      await expect(ensureMessagingRetentionMigration(weakenedLifecycle.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
    } finally {
      await weakenedLifecycle.close()
    }
  })

  it('refuses a lifecycle guard weakened to authorize without a request-row lock', async () => {
    const fixture = await createTestDb()
    try {
      const functionProof = await fixture.client.query<{ function_definition: string }>(`
        select pg_get_functiondef(
          'guard_quote_send_lifecycle()'::regprocedure
        ) as function_definition
      `)
      const original = functionProof.rows[0]!.function_definition
      const weakened = original.replace(/\n\s*for share/i, '')
      expect(weakened).not.toBe(original)
      await fixture.client.exec(weakened)
      await expect(ensureMessagingRetentionMigration(fixture.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
    } finally {
      await fixture.close()
    }
  })

  it('refuses lifecycle guards with a weakened multi-key suppression contract', async () => {
    const fixture = await createTestDb()
    try {
      const functionProof = await fixture.client.query<{ function_definition: string }>(`
        select pg_get_functiondef(
          'guard_quote_send_lifecycle()'::regprocedure
        ) as function_definition
      `)
      const original = functionProof.rows[0]!.function_definition
      const weakenings = [
        (definition: string) => definition.replace(
          /and suppression\.reason in \('verified_deletion', 'permanent_failure', 'number_reassigned'\)/i,
          'and suppression.reason is not null',
        ),
        (definition: string) => definition.replace(
          /\s+and suppression\.lifted_at is null/i,
          '',
        ),
        (definition: string) => definition.replace(
          /\s+and suppression\.retain_until >= approved_deletion_barrier/i,
          '',
        ),
        (definition: string) => definition.replace(
          /and suppression\.fingerprint_key_version = old\.fingerprint_key_version/i,
          'and suppression.fingerprint_key_version = suppression.fingerprint_key_version',
        ),
        (definition: string) => {
          const lock = definition.toLowerCase().lastIndexOf('for share')
          return lock < 0 ? definition : `${definition.slice(0, lock)}${definition.slice(lock + 9)}`
        },
      ]

      for (const weaken of weakenings) {
        const weakened = weaken(original)
        expect(weakened).not.toBe(original)
        await fixture.client.exec(weakened)
        await expect(ensureMessagingRetentionMigration(fixture.client)).rejects.toThrow(
          'partial messaging retention schema in ephemeral database',
        )
        await fixture.client.exec(original)
      }
    } finally {
      await fixture.close()
    }
  })

  it('enforces actor request, provider event, and notification deduplication keys', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedOperationalTenant(fixture.client)
      const requestKey = crypto.randomUUID()
      await insertQuoteSend(fixture.client, tenant, { requestKey })
      await expect(insertQuoteSend(fixture.client, tenant, { requestKey }))
        .rejects.toThrow(/quote_sends_shop_actor_request_uq/)
      const sendId = await insertQuoteSend(fixture.client, tenant)
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const operation = fixture.client.query(
          `insert into sms_log (
            shop_id, quote_send_id, provider_event_id, template_key,
            template_version, state, server_received_at, retain_until
          ) values ($1, $2, 'provider_event_1', 'quote_ready', 'v1',
            'accepted', now(), now() + interval '1 year')`,
          [tenant.shopId, sendId],
        )
        if (attempt === 0) await operation
        else await expect(operation).rejects.toThrow(/sms_log_shop_provider_event_uq/)
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const operation = fixture.client.query(
          `insert into notifications (
            shop_id, recipient_profile_id, event_type, entity_type,
            entity_id, dedupe_key, retain_until
          ) values ($1, $2, 'quote_ready', 'quote_send', $3, 'dedupe_3',
            now() + interval '90 days')`,
          [tenant.shopId, tenant.actorId, sendId],
        )
        if (attempt === 0) await operation
        else await expect(operation).rejects.toThrow(/notifications_shop_recipient_dedupe_uq/)
      }
    } finally {
      await fixture.close()
    }
  })

  it('keeps privacy fields absent and treats notification entity_id as routing, not authorization', async () => {
    const fixture = await createTestDb()
    try {
      const forbidden = await fixture.client.query<{ table_name: string; column_name: string }>(`
        select table_name, column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name in (
            'messaging_consent_events', 'messaging_consent_state', 'sms_suppressions',
            'messaging_deletion_requests', 'messaging_retention_holds', 'quote_sends',
            'sms_log', 'notifications'
          )
          and column_name in (
            'customer_name', 'name', 'phone', 'destination', 'vehicle', 'vin', 'plate',
            'diagnosis', 'complaint', 'quote_amount', 'price', 'amount', 'message',
            'message_body', 'body', 'raw_body', 'secure_url', 'url', 'token', 'raw_token'
          )
      `)
      expect(forbidden.rows).toEqual([])
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

  it('refuses an active-resource hold index weakened behind the expected name', async () => {
    const fixture = await createTestDb()
    try {
      await fixture.client.exec(`
        drop index messaging_retention_holds_active_resource_idx;
        create index messaging_retention_holds_active_resource_idx
          on messaging_retention_holds (shop_id, resource_type, resource_id);
      `)
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
          requesting_actor_profile_id, completed_at, latest_relevant_at, prior_record_counts,
          proof_summary, retain_until
        ) values ($1, $2, $3, $4, null, $5, 'key_v1', 'completed',
          'customer_request', $6, now(), now(), '{}'::jsonb, $7, now() + interval '5 years')`,
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
          requesting_actor_profile_id, completed_at, latest_relevant_at, proof_summary, retain_until
        ) values ($1, $2, $3, $4, $5, $6, 'key_v1', 'completed', 'customer_request', $7,
          now(), now(), '{}'::jsonb, now() + interval '5 years')`,
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

  it('enforces the canonical hold vocabulary and exact five-calendar-year audit anchor', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedTenant(fixture.client)
      const resourceId = crypto.randomUUID()
      await expect(fixture.client.query(
        `insert into messaging_retention_holds (
          shop_id, resource_type, resource_id, reason_code,
          authorizing_actor_profile_id, starts_at, review_at, expires_at, retain_until
        ) values ($1, 'consent_event', $2, 'legal_claim', $3,
          '2024-02-29 12:00:00+00', '2024-03-01 12:00:00+00',
          '2024-03-31 12:00:00+00', '2029-03-31 12:00:00+00')`,
        [tenant.shopId, resourceId, tenant.actorId],
      )).rejects.toThrow(/messaging_retention_holds_resource_type_valid/)
      await expect(fixture.client.query(
        `insert into messaging_retention_holds (
          shop_id, subject_key, reason_code, authorizing_actor_profile_id,
          starts_at, review_at, expires_at, retain_until
        ) values ($1, $2, 'free_text', $3,
          '2024-02-29 12:00:00+00', '2024-03-01 12:00:00+00',
          '2024-03-31 12:00:00+00', '2029-03-31 12:00:00+00')`,
        [tenant.shopId, crypto.randomUUID(), tenant.actorId],
      )).rejects.toThrow(/messaging_retention_holds_reason_code_valid/)
      await expect(fixture.client.query(
        `insert into messaging_retention_holds (
          shop_id, subject_key, reason_code, authorizing_actor_profile_id,
          starts_at, review_at, expires_at, retain_until
        ) values ($1, $2, 'subpoena', $3,
          '2024-02-29 12:00:00+00', '2024-03-01 12:00:00+00',
          '2024-03-31 12:00:00+00', '2029-03-31 11:59:59+00')`,
        [tenant.shopId, crypto.randomUUID(), tenant.actorId],
      )).rejects.toThrow(/messaging_retention_holds_retention_window_exact/)
    } finally {
      await fixture.close()
    }
  })

  it('guards hold deletion and purges only one exact expired hold through owner context', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedTenant(fixture.client)
      const other = await seedTenant(fixture.client)
      const earlyId = await insertHold(fixture.client, tenant, { subjectKey: crypto.randomUUID() })
      await expect(fixture.client.query(
        'delete from messaging_retention_holds where id = $1', [earlyId],
      )).rejects.toThrow(/messaging retention holds may only be purged after retention/)
      expect((await fixture.client.query<{ purged: boolean }>(
        'select purge_expired_messaging_retention_hold($1, $2) as purged',
        [tenant.shopId, earlyId],
      )).rows[0]?.purged).toBe(false)
      expect((await fixture.client.query<{ purged: boolean }>(
        'select purge_expired_messaging_retention_hold($1, $2) as purged',
        [other.shopId, earlyId],
      )).rows[0]?.purged).toBe(false)

      const expired = await fixture.client.query<{ id: string }>(
        `insert into messaging_retention_holds (
          shop_id, subject_key, reason_code, authorizing_actor_profile_id,
          starts_at, review_at, expires_at, retain_until
        ) values ($1, $2, 'legal_claim', $3,
          '2019-01-01 00:00:00+00', '2019-06-01 00:00:00+00',
          '2020-01-01 00:00:00+00', '2025-01-01 00:00:00+00') returning id`,
        [tenant.shopId, crypto.randomUUID(), tenant.actorId],
      )
      const expiredId = expired.rows[0]!.id
      await fixture.client.exec('begin')
      await fixture.client.exec('set local role service_role')
      await fixture.client.query(
        "select set_config('vyntechs.messaging_retention_hold_purge_shop', $1, true)",
        [tenant.shopId],
      )
      await fixture.client.query(
        "select set_config('vyntechs.messaging_retention_hold_purge_ids', $1, true)",
        [`{${expiredId}}`],
      )
      await expect(fixture.client.query(
        'delete from messaging_retention_holds where id = $1', [expiredId],
      )).rejects.toThrow(/messaging retention holds may only be purged after retention/)
      await fixture.client.exec('rollback')

      await fixture.client.exec('begin')
      expect((await fixture.client.query<{ purged: boolean }>(
        'select purge_expired_messaging_retention_hold($1, $2) as purged',
        [tenant.shopId, expiredId],
      )).rows[0]?.purged).toBe(true)
      await fixture.client.exec('commit')
      expect((await fixture.client.query<{ count: number }>(
        'select count(*)::int as count from messaging_retention_holds where id = $1',
        [expiredId],
      )).rows[0]?.count).toBe(0)
    } finally {
      await fixture.close()
    }
  })

  it('allows only one exact hold release and keeps lifecycle identity immutable', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedTenant(fixture.client)
      const hold = await fixture.client.query<{ id: string }>(
        `insert into messaging_retention_holds (
          shop_id, subject_key, reason_code, authorizing_actor_profile_id,
          starts_at, review_at, expires_at, retain_until
        ) values ($1, $2, 'security_investigation', $3,
          '2024-02-29 12:00:00+00', '2024-03-01 12:00:00+00',
          '2024-03-31 12:00:00+00', '2029-03-31 12:00:00+00') returning id`,
        [tenant.shopId, crypto.randomUUID(), tenant.actorId],
      )
      const holdId = hold.rows[0]!.id
      for (const mutation of [
        "reason_code = 'legal_claim'",
        "review_at = review_at + interval '1 day'",
        "expires_at = expires_at + interval '1 day'",
        "starts_at = starts_at + interval '1 second'",
        `authorizing_actor_profile_id = '${crypto.randomUUID()}'`,
        "retain_until = retain_until + interval '1 day'",
      ]) {
        await expect(fixture.client.query(
          `update messaging_retention_holds set ${mutation} where id = $1`, [holdId],
        )).rejects.toThrow(/messaging retention hold lifecycle is immutable/)
      }
      await expect(fixture.client.query(
        `update messaging_retention_holds
        set released_at = '2024-04-01 12:00:00+00',
          retain_until = '2030-04-01 12:00:00+00'
        where id = $1`, [holdId],
      )).rejects.toThrow(/messaging retention hold lifecycle is immutable/)
      await fixture.client.query(
        `update messaging_retention_holds
        set released_at = '2024-04-01 12:00:00+00' where id = $1`, [holdId],
      )
      const released = await fixture.client.query<{ released_at: Date; retain_until: Date }>(
        'select released_at, retain_until from messaging_retention_holds where id = $1', [holdId],
      )
      expect(released.rows[0]).toEqual({
        released_at: new Date('2024-04-01T12:00:00.000Z'),
        retain_until: new Date('2029-04-01T12:00:00.000Z'),
      })
      await expect(fixture.client.query(
        `update messaging_retention_holds
        set released_at = '2024-04-02 12:00:00+00' where id = $1`, [holdId],
      )).rejects.toThrow(/messaging retention hold may only be released once/)
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

  it('purges only an exact expired unreferenced consent event through owner context', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedTenant(fixture.client)
      const subjectKey = crypto.randomUUID()
      const earlyId = await insertConsentEvent(fixture.client, tenant, {
        subjectKey, retainUntil: "clock_timestamp() + interval '1 day'",
      })
      expect((await fixture.client.query<{ purged: boolean }>(
        'select purge_expired_messaging_consent_event($1, $2) as purged',
        [tenant.shopId, earlyId],
      )).rows[0]?.purged).toBe(false)

      const heldId = await insertConsentEvent(fixture.client, tenant, {
        subjectKey, retainUntil: "clock_timestamp() - interval '1 second'",
      })
      await insertHold(fixture.client, tenant, { subjectKey })
      await expect(fixture.client.query(
        'select purge_expired_messaging_consent_event($1, $2)', [tenant.shopId, heldId],
      )).rejects.toThrow(/active messaging retention hold blocks consent event purge/)
      await fixture.client.query(
        `update messaging_retention_holds set released_at = clock_timestamp()
        where subject_key = $1`, [subjectKey],
      )

      await insertHold(fixture.client, tenant, {
        resourceType: 'messaging_consent_event', resourceId: heldId,
      })
      await expect(fixture.client.query(
        'select purge_expired_messaging_consent_event($1, $2)', [tenant.shopId, heldId],
      )).rejects.toThrow(/active messaging retention hold blocks consent event purge/)
      await fixture.client.query(
        `update messaging_retention_holds set released_at = clock_timestamp()
        where resource_type = 'messaging_consent_event' and resource_id = $1`, [heldId],
      )

      await fixture.client.query(
        `insert into messaging_consent_state (
          shop_id, subject_key, customer_id, destination_fingerprint,
          fingerprint_key_version, program_version, status, source_event_id,
          consented_at, retain_until
        ) values ($1, $2, $3, $4, 'key_v1', 'repair_updates_v1',
          'consented', $5, now(), now() + interval '5 years')`,
        [tenant.shopId, subjectKey, tenant.customerId, hex, heldId],
      )
      await expect(fixture.client.query(
        'select purge_expired_messaging_consent_event($1, $2)', [tenant.shopId, heldId],
      )).rejects.toThrow(/consent projection still references event/)
      await fixture.client.exec('delete from messaging_consent_state')

      await fixture.client.query(
        `insert into sms_suppressions (
          shop_id, destination_fingerprint, fingerprint_key_version, source_event_id,
          reason, retain_until
        ) values ($1, $2, 'key_v1', $3, 'customer_revocation', now() + interval '5 years')`,
        [tenant.shopId, otherHex, heldId],
      )
      await expect(fixture.client.query(
        'select purge_expired_messaging_consent_event($1, $2)', [tenant.shopId, heldId],
      )).rejects.toThrow(/suppression still references event/)
      await fixture.client.exec('delete from sms_suppressions')

      await fixture.client.exec('begin')
      expect((await fixture.client.query<{ purged: boolean }>(
        'select purge_expired_messaging_consent_event($1, $2) as purged',
        [tenant.shopId, heldId],
      )).rows[0]?.purged).toBe(true)
      await fixture.client.exec('commit')
      expect((await fixture.client.query<{ count: number }>(
        'select count(*)::int as count from messaging_consent_events where id = $1', [heldId],
      )).rows[0]?.count).toBe(0)
    } finally {
      await fixture.close()
    }
  })

  it('rejects cross-shop, forged purge context, and mixed event purge shops', async () => {
    const fixture = await createTestDb()
    try {
      const first = await seedTenant(fixture.client)
      const second = await seedTenant(fixture.client)
      const firstId = await insertConsentEvent(fixture.client, first, {
        retainUntil: "clock_timestamp() - interval '1 second'",
      })
      const secondId = await insertConsentEvent(fixture.client, second, {
        retainUntil: "clock_timestamp() - interval '1 second'",
      })
      expect((await fixture.client.query<{ purged: boolean }>(
        'select purge_expired_messaging_consent_event($1, $2) as purged',
        [second.shopId, firstId],
      )).rows[0]?.purged).toBe(false)

      await fixture.client.exec('begin')
      await fixture.client.exec('set local role service_role')
      await fixture.client.query(
        "select set_config('vyntechs.messaging_consent_purge_shop', $1, true)", [first.shopId],
      )
      await fixture.client.query(
        "select set_config('vyntechs.messaging_consent_purge_events', $1, true)", [`{${firstId}}`],
      )
      await expect(fixture.client.query(
        'delete from messaging_consent_events where id = $1', [firstId],
      )).rejects.toThrow(/messaging consent events are append-only/)
      await fixture.client.exec('rollback')

      await fixture.client.exec('begin')
      await fixture.client.query(
        'select purge_expired_messaging_consent_event($1, $2)', [first.shopId, firstId],
      )
      await expect(fixture.client.query(
        'select purge_expired_messaging_consent_event($1, $2)', [second.shopId, secondId],
      )).rejects.toThrow(/consent event purge transaction cannot mix shops/)
      await fixture.client.exec('rollback')
    } finally {
      await fixture.close()
    }
  })

  it('enforces one canonical pending deletion per shop and customer', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedTenant(fixture.client)
      await insertDeletionRequest(fixture.client, tenant, { subjectKey: crypto.randomUUID() })
      await expect(insertDeletionRequest(fixture.client, tenant, {
        subjectKey: crypto.randomUUID(),
      })).rejects.toThrow(/messaging_deletion_requests_shop_customer_pending_uq/)
    } finally {
      await fixture.close()
    }
  })

  it('compacts exact deletion work items without mutating unrepresented consent events', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedTenant(fixture.client)
      const requestId = await insertDeletionRequest(fixture.client, tenant, {
        subjectKey: tenant.customerId,
      })
      await fixture.client.query(
        `with seeded as (
          select i,
            (md5('task-3-event-' || i::text))::uuid as event_id,
            repeat(md5('task-3-destination-' || i::text), 2) as destination_fingerprint
          from generate_series(1, 258) series(i)
        )
        insert into messaging_consent_events (
          id, shop_id, subject_key, customer_id, destination_fingerprint,
          fingerprint_key_version, program_version, event_type, committed_at, occurred_at,
          capture_method, customer_controlled, evidence_kind, actor_profile_id,
          request_key, request_fingerprint, retain_until
        )
        select event_id, $1, $2, $2, destination_fingerprint,
          'key_v1', case when i = 258 then 'internal_deletion_v1' else 'repair_updates_v1' end,
          case when i = 258 then 'deleted' else 'consented' end,
          now() + i * interval '1 millisecond', now() + i * interval '1 millisecond',
          'staff_request', false, 'staff_request', $3,
          (md5('task-3-request-' || i::text))::uuid, $4,
          now() + interval '5 years'
        from seeded`,
        [tenant.shopId, tenant.customerId, tenant.actorId, hex],
      )
      await fixture.client.query(
        `with seeded as (
          select i,
            (md5('task-3-event-' || i::text))::uuid as event_id,
            repeat(md5('task-3-destination-' || i::text), 2) as destination_fingerprint
          from generate_series(1, 258) series(i)
        )
        insert into sms_suppressions (
          shop_id, destination_fingerprint, fingerprint_key_version, source_event_id,
          reason, suppressed_at, retain_until
        )
        select $1, destination_fingerprint, 'key_v1', event_id,
          'customer_revocation', now(), now() + interval '5 years'
        from seeded`,
        [tenant.shopId],
      )
      await fixture.client.query(
        `with seeded as (
          select i,
            (md5('task-3-event-' || i::text))::uuid as event_id,
            (md5('task-3-work-' || i::text))::uuid as work_item_id
          from generate_series(1, 258) series(i)
        )
        insert into messaging_deletion_work_items (
          id, shop_id, request_id, resource_type, resource_id, counts_toward_proof
        )
        select work_item_id, $1, $2, 'consent_event', event_id, i <> 258
        from seeded`,
        [tenant.shopId, requestId],
      )
      const seeded = (await fixture.client.query<{
        i: number
        event_id: string
        work_item_id: string
      }>(`select i,
          (md5('task-3-event-' || i::text))::uuid as event_id,
          (md5('task-3-work-' || i::text))::uuid as work_item_id
        from generate_series(1, 258) series(i) order by i`)).rows
      const selected = seeded.slice(0, 256)

      const invalidExactSelections: Array<ReadonlyArray<string | null>> = [
        [],
        seeded.slice(0, 257).map(({ work_item_id }) => work_item_id),
        [seeded[0]!.work_item_id, seeded[0]!.work_item_id],
        [seeded[0]!.work_item_id, null],
        [seeded[0]!.work_item_id, crypto.randomUUID()],
      ]
      for (const workItemIds of invalidExactSelections) {
        await expect(fixture.client.query(
          'select compact_messaging_consent_work_items($1, $2, $3::uuid[])',
          [tenant.shopId, requestId, workItemIds],
        )).rejects.toThrow(/compaction requires/)
      }
      expect((await fixture.client.query<{
        event_count: number
        pending_count: number
        attached_suppression_count: number
      }>(`select
          (select count(*)::int from messaging_consent_events
            where shop_id = $1) as event_count,
          (select count(*)::int from messaging_deletion_work_items
            where request_id = $2 and outcome = 'pending') as pending_count,
          (select count(*)::int from sms_suppressions
            where shop_id = $1 and source_event_id is not null) as attached_suppression_count`,
      [tenant.shopId, requestId])).rows[0]).toEqual({
        event_count: 258,
        pending_count: 258,
        attached_suppression_count: 258,
      })

      expect((await fixture.client.query<{ advanced: number }>(
        'select compact_messaging_consent_work_items($1, $2, $3::uuid[]) as advanced',
        [tenant.shopId, requestId, selected.map(({ work_item_id }) => work_item_id)],
      )).rows[0]?.advanced).toBe(256)

      expect((await fixture.client.query<{ id: string }>(
        'select id from messaging_consent_events where shop_id = $1 order by id',
        [tenant.shopId],
      )).rows.map(({ id }) => id).sort()).toEqual(
        seeded.slice(256).map(({ event_id }) => event_id).sort(),
      )
      const suppressions = (await fixture.client.query<{
        source_event_id: string | null
      }>('select source_event_id from sms_suppressions where shop_id = $1', [tenant.shopId])).rows
      expect(suppressions.filter(({ source_event_id }) => source_event_id === null)).toHaveLength(256)
      expect(suppressions.map(({ source_event_id }) => source_event_id).filter(Boolean).sort())
        .toEqual(seeded.slice(256).map(({ event_id }) => event_id).sort())

      const workItems = (await fixture.client.query<{
        id: string
        outcome: string
        counts_toward_proof: boolean
        detached_suppression_sources: number
      }>(`select id, outcome, counts_toward_proof, detached_suppression_sources
          from messaging_deletion_work_items where request_id = $1`, [requestId])).rows
      for (const item of selected) {
        expect(workItems.find(({ id }) => id === item.work_item_id)).toMatchObject({
          outcome: 'deleted',
          counts_toward_proof: true,
          detached_suppression_sources: 1,
        })
      }
      expect(workItems.find(({ id }) => id === seeded[257]!.work_item_id)).toMatchObject({
        outcome: 'pending',
        counts_toward_proof: false,
        detached_suppression_sources: 0,
      })

      await expect(fixture.client.query(
        'select compact_messaging_consent_work_items($1, $2, $3::uuid[])',
        [tenant.shopId, requestId, selected.map(({ work_item_id }) => work_item_id)],
      )).rejects.toThrow(/pending or retained consent-event work items|required/)

      const remaining = seeded.slice(256)
      expect((await fixture.client.query<{ advanced: number }>(
        'select compact_messaging_consent_work_items($1, $2, $3::uuid[]) as advanced',
        [tenant.shopId, requestId, remaining.map(({ work_item_id }) => work_item_id)],
      )).rows[0]?.advanced).toBe(2)
      expect((await fixture.client.query<{ count: number }>(
        'select count(*)::int as count from messaging_consent_events where shop_id = $1',
        [tenant.shopId],
      )).rows[0]?.count).toBe(0)
      expect((await fixture.client.query<{
        outcome: string
        counts_toward_proof: boolean
      }>(`select outcome, counts_toward_proof
          from messaging_deletion_work_items where id = $1`,
      [seeded[257]!.work_item_id])).rows[0]).toEqual({
        outcome: 'deleted',
        counts_toward_proof: false,
      })
    } finally {
      await fixture.close()
    }
  })

  it('rolls back work outcomes when exact consent compaction fails after source mutation', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedTenant(fixture.client)
      const requestId = await insertDeletionRequest(fixture.client, tenant, {
        subjectKey: tenant.customerId,
      })
      const eventId = await insertConsentEvent(fixture.client, tenant, {
        subjectKey: tenant.customerId,
        customerId: tenant.customerId,
        eventType: 'revoked',
        programVersion: 'repair_updates_v1',
      })
      await insertSuppression(fixture.client, tenant, { sourceEventId: eventId })
      const workItemId = crypto.randomUUID()
      await fixture.client.query(
        `insert into messaging_deletion_work_items (
          id, shop_id, request_id, resource_type, resource_id
        ) values ($1, $2, $3, 'consent_event', $4)`,
        [workItemId, tenant.shopId, requestId, eventId],
      )
      await fixture.client.exec(`
        create function fail_task_3_work_outcome() returns trigger language plpgsql as $$
        begin
          if old.outcome = 'pending' and new.outcome = 'deleted' then
            raise exception 'injected work outcome failure';
          end if;
          return new;
        end;
        $$;
        create trigger fail_task_3_work_outcome
        before update on messaging_deletion_work_items
        for each row execute function fail_task_3_work_outcome();
      `)

      await expect(fixture.client.query(
        'select compact_messaging_consent_work_items($1, $2, $3::uuid[])',
        [tenant.shopId, requestId, [workItemId]],
      )).rejects.toThrow(/injected work outcome failure/)
      expect((await fixture.client.query<{ id: string }>(
        'select id from messaging_consent_events where id = $1', [eventId],
      )).rows).toEqual([{ id: eventId }])
      expect((await fixture.client.query<{ source_event_id: string | null }>(
        'select source_event_id from sms_suppressions where shop_id = $1', [tenant.shopId],
      )).rows[0]?.source_event_id).toBe(eventId)
      expect((await fixture.client.query<{ outcome: string }>(
        'select outcome from messaging_deletion_work_items where id = $1', [workItemId],
      )).rows[0]?.outcome).toBe('pending')
    } finally {
      await fixture.close()
    }
  })

  it('purges completed tombstones only at or after the exact retention boundary', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedTenant(fixture.client)
      const futureId = await insertDeletionRequest(fixture.client, tenant, {
        subjectKey: crypto.randomUUID(), state: 'completed', retainUntil: 'future',
      })
      const before = await fixture.client.query<{ purged: boolean }>(
        'select purge_expired_messaging_deletion_request($1, $2) as purged',
        [tenant.shopId, futureId],
      )
      expect(before.rows[0]?.purged).toBe(false)

      await fixture.client.exec('begin')
      const boundaryId = await insertDeletionRequest(fixture.client, tenant, {
        subjectKey: crypto.randomUUID(), state: 'completed', retainUntil: 'now',
      })
      const atBoundary = await fixture.client.query<{ purged: boolean }>(
        'select purge_expired_messaging_deletion_request($1, $2) as purged',
        [tenant.shopId, boundaryId],
      )
      expect(atBoundary.rows[0]?.purged).toBe(true)
      await fixture.client.exec('commit')
    } finally {
      await fixture.close()
    }
  })

  it('locks the exact shop before the tombstone and revalidates expiry after both locks', async () => {
    const fixture = await createTestDb()
    try {
      const source = (await fixture.client.query<{ definition: string }>(`
        select pg_get_functiondef(
          'purge_expired_messaging_deletion_request(uuid,uuid)'::regprocedure
        ) as definition
      `)).rows[0]!.definition.toLowerCase().replace(/\s+/g, ' ')
      const shopLock = 'from public.shops locked_shop where locked_shop.id = p_shop_id for update'
      const requestLock = 'from public.messaging_deletion_requests where shop_id = p_shop_id and id = p_request_id for update'
      const expiryCheck = 'and retain_until <= clock_timestamp()'
      const holdCheck = 'from public.messaging_retention_holds h'
      expect(source).toContain(shopLock)
      expect(source).toContain(requestLock)
      expect(source).toContain(expiryCheck)
      expect(source.indexOf(shopLock)).toBeLessThan(source.indexOf(requestLock))
      expect(source.indexOf(requestLock)).toBeLessThan(source.indexOf(expiryCheck))
      expect(source.indexOf(expiryCheck)).toBeLessThan(source.indexOf(holdCheck))
    } finally {
      await fixture.close()
    }
  })

  it('blocks tombstone purge for active request and subject holds', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedTenant(fixture.client)
      const subjectKey = crypto.randomUUID()
      const requestId = await insertDeletionRequest(fixture.client, tenant, {
        subjectKey, state: 'completed', retainUntil: 'past',
      })
      await insertHold(fixture.client, tenant, {
        resourceType: 'messaging_deletion_request',
        resourceId: requestId,
      })
      await expect(fixture.client.query(
        'select purge_expired_messaging_deletion_request($1, $2)',
        [tenant.shopId, requestId],
      )).rejects.toThrow(/active messaging retention hold blocks purge/)
      await fixture.client.exec(`
        update messaging_retention_holds set released_at = clock_timestamp()
        where released_at is null
      `)
      await insertHold(fixture.client, tenant, { subjectKey })
      await expect(fixture.client.query(
        'select purge_expired_messaging_deletion_request($1, $2)',
        [tenant.shopId, requestId],
      )).rejects.toThrow(/active messaging retention hold blocks purge/)
    } finally {
      await fixture.close()
    }
  })

  it('refuses PUBLIC and inherited effective client table access', async () => {
    const publicFixture = await createTestDb()
    try {
      await publicFixture.client.exec('grant select on messaging_consent_events to public')
      await expect(ensureMessagingRetentionMigration(publicFixture.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
    } finally {
      await publicFixture.close()
    }

    const inheritedFixture = await createTestDb()
    try {
      await inheritedFixture.client.exec(`
        create role messaging_retention_reader nologin;
        grant select on messaging_consent_events to messaging_retention_reader;
        grant messaging_retention_reader to authenticated;
      `)
      await expect(ensureMessagingRetentionMigration(inheritedFixture.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
    } finally {
      await inheritedFixture.close()
    }
  })

  it('refuses unsafe privileged function definitions and execution ACLs', async () => {
    const unsafeDefinition = await createTestDb()
    try {
      await unsafeDefinition.client.exec(
        'alter function compact_messaging_consent_work_items(uuid, uuid, uuid[]) security invoker',
      )
      await expect(ensureMessagingRetentionMigration(unsafeDefinition.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
      await unsafeDefinition.client.exec(`
        alter function compact_messaging_consent_work_items(uuid, uuid, uuid[]) security definer;
        alter function compact_messaging_consent_work_items(uuid, uuid, uuid[]) set search_path = public;
      `)
      await expect(ensureMessagingRetentionMigration(unsafeDefinition.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
    } finally {
      await unsafeDefinition.close()
    }

    const unsafeAcl = await createTestDb()
    try {
      await unsafeAcl.client.exec(
        'grant execute on function purge_expired_messaging_deletion_request(uuid, uuid) to public',
      )
      await expect(ensureMessagingRetentionMigration(unsafeAcl.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
    } finally {
      await unsafeAcl.close()
    }

    const unsafeEventPurge = await createTestDb()
    try {
      await unsafeEventPurge.client.exec(
        `alter function purge_expired_messaging_consent_event(uuid, uuid)
        set search_path = public`,
      )
      await expect(ensureMessagingRetentionMigration(unsafeEventPurge.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
    } finally {
      await unsafeEventPurge.close()
    }

    const missingFunction = await createTestDb()
    try {
      await missingFunction.client.exec(
        'drop function compact_messaging_consent_work_items(uuid, uuid, uuid[]) cascade',
      )
      await expect(ensureMessagingRetentionMigration(missingFunction.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
    } finally {
      await missingFunction.close()
    }
  })

  it('rejects a marker-spoofing no-op hold purge and an untrusted purge owner', async () => {
    const noOp = await createTestDb()
    try {
      await noOp.client.exec(`
        create or replace function purge_expired_messaging_retention_hold(
          p_shop_id uuid, p_hold_id uuid
        )
        returns boolean language plpgsql security definer set search_path = '' as $$
        begin
          perform clock_timestamp();
          perform current_setting('vyntechs.messaging_retention_hold_purge_shop', true);
          perform current_setting('vyntechs.messaging_retention_hold_purge_ids', true);
          perform 1 from public.shops locked_shop where locked_shop.id = p_shop_id for update;
          return false;
        end;
        $$;
      `)
      await expect(ensureMessagingRetentionMigration(noOp.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
    } finally {
      await noOp.close()
    }

    const untrustedOwner = await createTestDb()
    try {
      await untrustedOwner.client.exec(
        `alter function purge_expired_messaging_retention_hold(uuid, uuid)
        owner to service_role`,
      )
      await expect(ensureMessagingRetentionMigration(untrustedOwner.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
    } finally {
      await untrustedOwner.close()
    }
  })

  it('refuses weakened customer-wide compaction authorization and deferred proof', async () => {
    const fixture = await createTestDb()
    try {
      const compactProof = await fixture.client.query<{ function_definition: string }>(`
        select pg_get_functiondef(
          'compact_messaging_consent_work_items(uuid,uuid,uuid[])'::regprocedure
        ) as function_definition
      `)
      const completionProof = await fixture.client.query<{ function_definition: string }>(`
        select pg_get_functiondef(
          'require_messaging_compaction_completion()'::regprocedure
        ) as function_definition
      `)
      const compact = compactProof.rows[0]!.function_definition
      const completion = completionProof.rows[0]!.function_definition
      const weakenings = [
        compact.replace(/\s+and event\.customer_id = request_customer_id/i, ''),
        compact.replace(/array_agg\(distinct event_id order by event_id\)/i, 'array_agg(event_id)'),
        completion.replace(/old\.id = any\(compaction_event_ids\)/i, 'true'),
        completion.replace(/r\.shop_id = old\.shop_id/i, 'true'),
        completion.replace(/old\.id = any\(purge_event_ids\)/i, 'true'),
      ]

      for (const weakened of weakenings) {
        expect(weakened).not.toBe(compact)
        expect(weakened).not.toBe(completion)
        await fixture.client.exec(weakened)
        await expect(ensureMessagingRetentionMigration(fixture.client)).rejects.toThrow(
          'partial messaging retention schema in ephemeral database',
        )
        await fixture.client.exec(weakened.includes('compact_messaging_consent_work_items')
          ? compact
          : completion)
      }
    } finally {
      await fixture.close()
    }
  })

  it('refuses a trigger rebound to the wrong guard function', async () => {
    const fixture = await createTestDb()
    try {
      await fixture.client.exec(`
        drop trigger messaging_consent_events_append_only on messaging_consent_events;
        create trigger messaging_consent_events_append_only
          before update or delete on messaging_consent_events
          for each row execute function guard_messaging_deletion_request_mutation();
      `)
      await expect(ensureMessagingRetentionMigration(fixture.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
    } finally {
      await fixture.close()
    }
  })

  it('requires the exact five-calendar-year completed tombstone window', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedTenant(fixture.client)
      const insertCompleted = (
        retainUntil: string,
        latestRelevantAt = '2024-02-29 12:00:00+00',
      ) => {
        const id = crypto.randomUUID()
        return fixture.client.query(
          `insert into messaging_deletion_requests (
            id, request_key, request_fingerprint, shop_id, subject_key, customer_id,
            destination_fingerprint, fingerprint_key_version, state, reason_code,
            requesting_actor_profile_id, completed_at, latest_relevant_at,
            prior_record_counts, proof_summary, retain_until
          ) values (
            $1, $2, $3, $4, $5, null, $6, 'key_v1', 'completed',
            'customer_request', $7, $8, $8, '{}'::jsonb, '{}'::jsonb, $9
          )`,
          [id, crypto.randomUUID(), hex, tenant.shopId, crypto.randomUUID(), hex,
            tenant.actorId, latestRelevantAt, retainUntil],
        ).then(() => id)
      }
      const exactId = await insertCompleted('2029-02-28 12:00:00+00')
      const exact = await fixture.client.query<{
        latest_relevant_at: Date
        retain_until: Date
      }>(`
        select latest_relevant_at, retain_until
        from messaging_deletion_requests where id = $1
      `, [exactId])
      expect(exact.rows[0]).toMatchObject({
        latest_relevant_at: new Date('2024-02-29T12:00:00.000Z'),
        retain_until: new Date('2029-02-28T12:00:00.000Z'),
      })
      const immediatePurge = await fixture.client.query<{ purged: boolean }>(
        'select purge_expired_messaging_deletion_request($1, $2) as purged',
        [tenant.shopId, exactId],
      )
      expect(immediatePurge.rows[0]?.purged).toBe(false)

      for (const retainUntil of [
        '2029-02-28 11:59:59+00',
        '2029-02-28 12:00:01+00',
      ]) {
        await expect(insertCompleted(retainUntil)).rejects.toThrow(
          /messaging_deletion_requests_retention_window_exact/,
        )
      }
    } finally {
      await fixture.close()
    }
  })

  it('serializes hold inserts and rejects target mutation before any update lock', async () => {
    const fixture = await createTestDb()
    try {
      const functionProof = await fixture.client.query<{
        function_definition: string
      }>(`
        select pg_get_functiondef(
          'serialize_messaging_retention_hold_target()'::regprocedure
        ) as function_definition
      `)
      const functionDefinition = functionProof.rows[0]?.function_definition.toLowerCase()
      const normalizedFunction = functionDefinition?.replace(/\s+/g, ' ')
      const updateGuard = normalizedFunction!.indexOf("if tg_op = 'update' then")
      const unchangedReturn = normalizedFunction!.indexOf('return new; end if;', updateGuard)
      const shopLock = normalizedFunction!.indexOf('from public.shops locked_shop')
      expect(normalizedFunction).toContain(
        "raise exception 'messaging retention hold target is immutable'",
      )
      expect(normalizedFunction).toContain(
        'from public.shops locked_shop where locked_shop.id = new.shop_id for update',
      )
      expect(functionDefinition).toContain(
        'array_agg(distinct r.id order by r.id)',
      )
      expect(updateGuard).toBeGreaterThan(-1)
      expect(unchangedReturn).toBeGreaterThan(updateGuard)
      expect(unchangedReturn).toBeLessThan(shopLock)
      expect(shopLock).toBeLessThan(
        normalizedFunction!.indexOf('array_agg(distinct r.id order by r.id)'),
      )
      expect(functionDefinition).toContain(
        "messaging_deletion_request",
      )
      expect(functionDefinition).toContain(
        "messaging_consent_event",
      )

      const triggerProof = await fixture.client.query<{ trigger_definition: string }>(`
        select pg_get_triggerdef(oid) as trigger_definition
        from pg_trigger
        where tgname = 'messaging_retention_holds_serialize_target'
      `)
      expect(triggerProof.rows[0]?.trigger_definition).toContain(
        'BEFORE INSERT OR DELETE OR UPDATE ON public.messaging_retention_holds',
      )

      const tenant = await seedTenant(fixture.client)
      const firstSubject = crypto.randomUUID()
      const secondSubject = crypto.randomUUID()
      const secondCustomerId = crypto.randomUUID()
      await fixture.client.query(
        'insert into customers (id, shop_id, name, phone) values ($1, $2, $3, $4)',
        [secondCustomerId, tenant.shopId, 'Second Hold Customer', '+15550000002'],
      )
      await insertDeletionRequest(fixture.client, tenant, { subjectKey: firstSubject })
      await insertDeletionRequest(fixture.client, {
        ...tenant, customerId: secondCustomerId,
      }, { subjectKey: firstSubject })
      const hold = await fixture.client.query<{ id: string }>(
        `insert into messaging_retention_holds (
          shop_id, subject_key, reason_code, authorizing_actor_profile_id,
          starts_at, review_at, expires_at, retain_until
        ) values ($1, $2, 'legal_claim', $3, now(), now() + interval '1 day',
          now() + interval '30 days', now() + interval '30 days' + interval '5 years')
        returning id`,
        [tenant.shopId, firstSubject, tenant.actorId],
      )
      await expect(fixture.client.query(
        `update messaging_retention_holds
        set subject_key = $1
        where id = $2`,
        [secondSubject, hold.rows[0]?.id],
      )).rejects.toThrow(/messaging retention hold target is immutable/)
      await expect(fixture.client.query(
        `update messaging_retention_holds
        set shop_id = shop_id, resource_type = resource_type,
          resource_id = resource_id, subject_key = subject_key
        where id = $1`,
        [hold.rows[0]?.id],
      )).resolves.toBeDefined()
      await expect(fixture.client.query(
        `update messaging_retention_holds
        set released_at = now()
        where id = $1`,
        [hold.rows[0]?.id],
      )).resolves.toBeDefined()
      for (const resourceType of ['quote_send', 'sms_log', 'notification']) {
        await insertHold(fixture.client, tenant, {
          resourceType,
          resourceId: crypto.randomUUID(),
        })
      }
      await expect(insertHold(fixture.client, {
        ...tenant,
        shopId: crypto.randomUUID(),
      }, { subjectKey: crypto.randomUUID() })).rejects.toThrow(
        /messaging_retention_holds_shop_fk/,
      )
    } finally {
      await fixture.close()
    }
  })

  it('refuses unsafe or missing hold-serialization markers', async () => {
    const unsafeFunction = await createTestDb()
    try {
      await unsafeFunction.client.exec(
        `alter function serialize_messaging_retention_hold_target()
        set search_path = public`,
      )
      await expect(ensureMessagingRetentionMigration(unsafeFunction.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
    } finally {
      await unsafeFunction.close()
    }

    const missingTrigger = await createTestDb()
    try {
      await missingTrigger.client.exec(
        `drop trigger messaging_retention_holds_serialize_target
        on messaging_retention_holds`,
      )
      await expect(ensureMessagingRetentionMigration(missingTrigger.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
    } finally {
      await missingTrigger.close()
    }
  })

  it('refuses a hold serializer weakened to omit only the insert shop-row lock', async () => {
    const fixture = await createTestDb()
    try {
      const functionProof = await fixture.client.query<{ function_definition: string }>(`
        select pg_get_functiondef(
          'serialize_messaging_retention_hold_target()'::regprocedure
        ) as function_definition
      `)
      const original = functionProof.rows[0]!.function_definition
      const weakened = original.replace(
        /(from public\.shops locked_shop\s+where locked_shop\.id = new\.shop_id)\s+for update/i,
        '$1',
      )
      expect(weakened).not.toBe(original)
      expect(weakened.toLowerCase()).toContain('array_agg(distinct r.id order by r.id)')
      await fixture.client.exec(weakened)
      await expect(ensureMessagingRetentionMigration(fixture.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
    } finally {
      await fixture.close()
    }
  })

  it('refuses hold serializers that allow retargeting or lock inside UPDATE', async () => {
    const retargetable = await createTestDb()
    try {
      const functionProof = await retargetable.client.query<{ function_definition: string }>(`
        select pg_get_functiondef(
          'serialize_messaging_retention_hold_target()'::regprocedure
        ) as function_definition
      `)
      const original = functionProof.rows[0]!.function_definition
      const weakened = original.replace(
        /raise exception 'messaging retention hold target is immutable';/i,
        'return new;',
      )
      expect(weakened).not.toBe(original)
      await retargetable.client.exec(weakened)
      await expect(ensureMessagingRetentionMigration(retargetable.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
    } finally {
      await retargetable.close()
    }

    const updateLocker = await createTestDb()
    try {
      const functionProof = await updateLocker.client.query<{ function_definition: string }>(`
        select pg_get_functiondef(
          'serialize_messaging_retention_hold_target()'::regprocedure
        ) as function_definition
      `)
      const original = functionProof.rows[0]!.function_definition
      const weakened = original.replace(
        /if tg_op = 'UPDATE' then/i,
        `if tg_op = 'UPDATE' then
          perform 1 from public.shops where id = new.shop_id for update;`,
      )
      expect(weakened).not.toBe(original)
      await updateLocker.client.exec(weakened)
      await expect(ensureMessagingRetentionMigration(updateLocker.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
    } finally {
      await updateLocker.close()
    }
  })

  it('documents the exact shop-first Task 6 cleanup lock order', async () => {
    const plan = await readFile(path.join(
      process.cwd(),
      'docs/superpowers/plans/2026-07-12-shop-os-row31-messaging-retention-deletion.md',
    ), 'utf8')
    const taskSix = plan.slice(plan.indexOf('### Task 6:'), plan.indexOf('### Task 7:'))

    expect(taskSix).toContain(
      'shop → matching pending deletion requests → customer → quote sends → consent projection/events → child SMS logs → notifications → active holds',
    )
    expect(taskSix).toContain(
      'Hold the shop lock through the final hold scan, every cleanup delete or update, and transaction commit.',
    )
    expect(taskSix).toContain(
      'Hold targets are immutable: cleanup never mutates or reparents a hold target, and renewal creates a new hold row with a new authorization.',
    )
    expect(taskSix).toContain(
      'normalize every relevant current and still-supported legacy suppression row to an active, non-liftable deletion barrier',
    )
    expect(taskSix).toContain(
      "The guard then consumes phase one's suppression contract for the old send key",
    )
  })
})
