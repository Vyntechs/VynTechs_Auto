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
  }> = {},
) {
  const values = {
    shopId: tenant.shopId,
    ticketId: tenant.ticketId,
    quoteVersionId: tenant.quoteVersionId,
    customerId: tenant.customerId,
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
    ...overrides,
  }
  const result = await client.query<{ id: string }>(
    `insert into quote_sends (
      shop_id, ticket_id, quote_version_id, customer_id,
      destination_fingerprint, fingerprint_key_version, channel,
      token_hash, token_expires_at, requesting_actor_profile_id,
      request_key, request_fingerprint, state, submitting_at,
      submitted_at, terminal_at, retain_until
    ) values (
      $1, $2, $3, $4, $5, 'key_v1', 'sms', $6,
      ${values.tokenExpiresAt ?? 'null'}, $7, $8, $9, $10,
      ${values.submittingAt ?? 'null'}, ${values.submittedAt ?? 'null'},
      ${values.terminalAt ?? 'null'}, ${values.retainUntil ?? 'null'}
    ) returning id`,
    [values.shopId, values.ticketId, values.quoteVersionId, values.customerId,
      hex, values.tokenHash, values.actorId, values.requestKey,
      values.requestFingerprint, values.state],
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
      values.subjectKey,
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

async function insertDeletionRequest(
  client: PGlite,
  tenant: Awaited<ReturnType<typeof seedTenant>>,
  input: {
    subjectKey: string
    state?: 'pending' | 'completed'
    retainUntil?: 'now' | 'future' | 'past'
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
      'key_v1', '${state}', 'customer_request', $8,
      ${state === 'completed' ? latestRelevantAt : 'null'},
      ${state === 'completed' ? latestRelevantAt : 'null'},
      ${state === 'completed' ? "'{}'::jsonb" : 'null'},
      ${state === 'completed' ? "'{}'::jsonb" : 'null'},
      ${state === 'completed' ? retainUntil : 'null'}
    )`,
    [requestId, crypto.randomUUID(), hex, tenant.shopId, input.subjectKey,
      state === 'pending' ? tenant.customerId : null, hex, tenant.actorId],
  )
  return requestId
}

async function insertHold(
  client: PGlite,
  tenant: Awaited<ReturnType<typeof seedTenant>>,
  target: { subjectKey: string } | { resourceType: string; resourceId: string },
) {
  await client.query(
    `insert into messaging_retention_holds (
      shop_id, resource_type, resource_id, subject_key, reason_code,
      authorizing_actor_profile_id, starts_at, review_at, expires_at, retain_until
    ) values ($1, $2, $3, $4, 'legal_claim', $5,
      now() - interval '1 minute', now() + interval '1 day',
      now() + interval '30 days', now() + interval '5 years')`,
    [
      tenant.shopId,
      'resourceType' in target ? target.resourceType : null,
      'resourceId' in target ? target.resourceId : null,
      'subjectKey' in target ? target.subjectKey : null,
      tenant.actorId,
    ],
  )
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
    expect(getTableColumns(messagingDeletionRequests)).toMatchObject({
      latestRelevantAt: expect.anything(),
    })
  })

  it('declares the three dormant operation tables and quote-event send reference', () => {
    expect([quoteSends, smsLog, notifications].map((table) => getTableConfig(table).name))
      .toEqual(['quote_sends', 'sms_log', 'notifications'])
    expect(getTableConfig(quoteEvents).foreignKeys.map((key) => key.getName()))
      .toContain('quote_events_shop_ticket_send_fk')
    expect(getTableColumns(quoteSends)).toMatchObject({
      shopId: expect.anything(),
      ticketId: expect.anything(),
      quoteVersionId: expect.anything(),
      customerId: expect.anything(),
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

  it('enforces same-shop operation references and quote-event send integrity', async () => {
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
        ) values ($1, $2, 'quote_ready', 'v1', 'accepted', now(), now())`,
        [second.shopId, sendId],
      )).rejects.toThrow(/sms_log_shop_send_fk/)
      await expect(fixture.client.query(
        `insert into notifications (
          shop_id, recipient_profile_id, event_type, entity_type,
          entity_id, dedupe_key, retain_until
        ) values ($1, $2, 'quote_ready', 'quote_send', $3, 'dedupe_1', now())`,
        [first.shopId, second.actorId, sendId],
      )).rejects.toThrow(/notifications_shop_recipient_fk/)
      await expect(fixture.client.query(
        `insert into quote_events (
          shop_id, ticket_id, quote_version_id, quote_send_id, kind, request_key
        ) values ($1, $2, $3, $4, 'sent', $5)`,
        [second.shopId, second.ticketId, second.quoteVersionId, sendId, crypto.randomUUID()],
      )).rejects.toThrow(/quote_events_shop_ticket_send_fk/)
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
        state: 'cancelled',
        tokenHash: null,
        tokenExpiresAt: null,
        terminalAt: 'now()',
        retainUntil: "now() - interval '1 second'",
      })).rejects.toThrow(/quote_sends_retention_timestamp_valid/)

      const sendId = await insertQuoteSend(fixture.client, tenant)
      await expect(fixture.client.query(
        `insert into sms_log (
          shop_id, quote_send_id, provider_message_id, template_key,
          template_version, state, server_received_at, retain_until
        ) values ($1, $2, $3, 'quote_ready', 'v1', 'accepted', now(), now())`,
        [tenant.shopId, sendId, 'x'.repeat(257)],
      )).rejects.toThrow(/sms_log_provider_message_id_valid/)
      await expect(fixture.client.query(
        `insert into sms_log (
          shop_id, quote_send_id, provider_event_id, template_key,
          template_version, state, server_received_at, retain_until
        ) values ($1, $2, $3, 'quote_ready', 'v1', 'accepted', now(), now())`,
        [tenant.shopId, sendId, 'x'.repeat(257)],
      )).rejects.toThrow(/sms_log_provider_event_id_valid/)
      await expect(fixture.client.query(
        `insert into sms_log (
          shop_id, quote_send_id, template_key, template_version, state,
          server_received_at, retain_until
        ) values ($1, $2, $3, 'v1', 'accepted', now(), now())`,
        [tenant.shopId, sendId, 'x'.repeat(65)],
      )).rejects.toThrow(/sms_log_template_key_valid/)
      await expect(fixture.client.query(
        `insert into sms_log (
          shop_id, quote_send_id, template_key, template_version, state,
          error_code, server_received_at, retain_until
        ) values ($1, $2, 'quote_ready', 'v1', 'accepted', $3, now(), now())`,
        [tenant.shopId, sendId, 'x'.repeat(129)],
      )).rejects.toThrow(/sms_log_error_code_valid/)
      await expect(fixture.client.query(
        `insert into sms_log (
          shop_id, quote_send_id, template_key, template_version, state,
          server_received_at, retain_until
        ) values ($1, $2, 'quote_ready', 'v1', 'unknown', now(), now())`,
        [tenant.shopId, sendId],
      )).rejects.toThrow(/sms_log_state_valid/)
      await expect(fixture.client.query(
        `insert into notifications (
          shop_id, recipient_profile_id, event_type, entity_type,
          entity_id, dedupe_key, created_at, read_at, retain_until
        ) values ($1, $2, 'quote_ready', 'quote_send', $3, 'dedupe_2',
          now(), now() - interval '1 second', now())`,
        [tenant.shopId, tenant.actorId, sendId],
      )).rejects.toThrow(/notifications_read_at_valid/)
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
            'accepted', now(), now())`,
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
          ) values ($1, $2, 'quote_ready', 'quote_send', $3, 'dedupe_3', now())`,
          [tenant.shopId, tenant.actorId, sendId],
        )
        if (attempt === 0) await operation
        else await expect(operation).rejects.toThrow(/notifications_shop_recipient_dedupe_uq/)
      }
    } finally {
      await fixture.close()
    }
  })

  it('keeps every Row 31 table free of raw destination, message, URL, and token columns', async () => {
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
            'message_body', 'raw_body', 'destination', 'phone', 'secure_url', 'token'
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
          latest_relevant_at = now(),
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

  it('requires a matching pending request and keeps compaction atomic with tombstone completion', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedTenant(fixture.client)
      const subjectKey = crypto.randomUUID()
      await insertConsentEvent(fixture.client, tenant, { subjectKey })

      await expect(fixture.client.query(
        'select compact_messaging_consent_events($1, $2, $3)',
        [tenant.shopId, subjectKey, crypto.randomUUID()],
      )).rejects.toThrow(/matching pending messaging deletion request required/)

      const requestId = await insertDeletionRequest(fixture.client, tenant, { subjectKey })
      await expect(fixture.client.query(
        'select compact_messaging_consent_events($1, $2, $3)',
        [tenant.shopId, subjectKey, requestId],
      )).rejects.toThrow(/compaction requires completed tombstone in the same transaction/)

      const afterAutocommit = await fixture.client.query<{ event_count: number; state: string }>(`
        select
          (select count(*)::int from messaging_consent_events where subject_key = $1) as event_count,
          (select state from messaging_deletion_requests where id = $2) as state
      `, [subjectKey, requestId])
      expect(afterAutocommit.rows[0]).toEqual({ event_count: 1, state: 'pending' })

      await fixture.client.exec('begin')
      await fixture.client.query(
        'select compact_messaging_consent_events($1, $2, $3)',
        [tenant.shopId, subjectKey, requestId],
      )
      await fixture.client.query(
        `update messaging_deletion_requests set
          state = 'completed', customer_id = null, completed_at = now(),
          latest_relevant_at = now(),
          prior_record_counts = '{}'::jsonb, proof_summary = '{}'::jsonb,
          retain_until = now() + interval '5 years'
        where id = $1`,
        [requestId],
      )
      await fixture.client.exec('rollback')

      const afterRollback = await fixture.client.query<{ event_count: number; state: string }>(`
        select
          (select count(*)::int from messaging_consent_events where subject_key = $1) as event_count,
          (select state from messaging_deletion_requests where id = $2) as state
      `, [subjectKey, requestId])
      expect(afterRollback.rows[0]).toEqual({ event_count: 1, state: 'pending' })

      await fixture.client.exec('begin')
      await fixture.client.query(
        'select compact_messaging_consent_events($1, $2, $3)',
        [tenant.shopId, subjectKey, requestId],
      )
      await fixture.client.query(
        `update messaging_deletion_requests set
          state = 'completed', customer_id = null, completed_at = now(),
          latest_relevant_at = now(),
          prior_record_counts = '{}'::jsonb, proof_summary = '{}'::jsonb,
          retain_until = now() + interval '5 years'
        where id = $1`,
        [requestId],
      )
      await fixture.client.exec('commit')
      const afterCommit = await fixture.client.query<{ event_count: number; state: string }>(`
        select
          (select count(*)::int from messaging_consent_events where subject_key = $1) as event_count,
          (select state from messaging_deletion_requests where id = $2) as state
      `, [subjectKey, requestId])
      expect(afterCommit.rows[0]).toEqual({ event_count: 0, state: 'completed' })
    } finally {
      await fixture.close()
    }
  })

  it('blocks compaction for active subject and consent-event holds', async () => {
    const fixture = await createTestDb()
    try {
      const tenant = await seedTenant(fixture.client)
      const subjectKey = crypto.randomUUID()
      const eventId = await insertConsentEvent(fixture.client, tenant, { subjectKey })
      const requestId = await insertDeletionRequest(fixture.client, tenant, { subjectKey })

      await insertHold(fixture.client, tenant, { subjectKey })
      await expect(fixture.client.query(
        'select compact_messaging_consent_events($1, $2, $3)',
        [tenant.shopId, subjectKey, requestId],
      )).rejects.toThrow(/active messaging retention hold blocks compaction/)
      await fixture.client.exec('delete from messaging_retention_holds')

      await insertHold(fixture.client, tenant, {
        resourceType: 'messaging_consent_event',
        resourceId: eventId,
      })
      await expect(fixture.client.query(
        'select compact_messaging_consent_events($1, $2, $3)',
        [tenant.shopId, subjectKey, requestId],
      )).rejects.toThrow(/active messaging retention hold blocks compaction/)
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
      await fixture.client.exec('delete from messaging_retention_holds')
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
        'alter function compact_messaging_consent_events(uuid, uuid, uuid) security invoker',
      )
      await expect(ensureMessagingRetentionMigration(unsafeDefinition.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
      await unsafeDefinition.client.exec(`
        alter function compact_messaging_consent_events(uuid, uuid, uuid) security definer;
        alter function compact_messaging_consent_events(uuid, uuid, uuid) set search_path = public;
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

    const missingFunction = await createTestDb()
    try {
      await missingFunction.client.exec(
        'drop function compact_messaging_consent_events(uuid, uuid, uuid) cascade',
      )
      await expect(ensureMessagingRetentionMigration(missingFunction.client)).rejects.toThrow(
        'partial messaging retention schema in ephemeral database',
      )
    } finally {
      await missingFunction.close()
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
      const exactId = await insertDeletionRequest(fixture.client, tenant, {
        subjectKey: crypto.randomUUID(),
      })
      await fixture.client.query(
        `update messaging_deletion_requests set
          state = 'completed', customer_id = null,
          completed_at = '2024-02-29 12:00:00+00',
          latest_relevant_at = '2024-02-29 12:00:00+00',
          prior_record_counts = '{}'::jsonb, proof_summary = '{}'::jsonb,
          retain_until = '2029-02-28 12:00:00+00'
        where id = $1`,
        [exactId],
      )
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
        const invalidId = await insertDeletionRequest(fixture.client, tenant, {
          subjectKey: crypto.randomUUID(),
        })
        await expect(fixture.client.query(
          `update messaging_deletion_requests set
            state = 'completed', customer_id = null,
            completed_at = '2024-02-29 12:00:00+00',
            latest_relevant_at = '2024-02-29 12:00:00+00',
            prior_record_counts = '{}'::jsonb, proof_summary = '{}'::jsonb,
            retain_until = $1
          where id = $2`,
          [retainUntil, invalidId],
        )).rejects.toThrow(/messaging_deletion_requests_retention_window_exact/)
      }

      const immediateRetentionId = await insertDeletionRequest(fixture.client, tenant, {
        subjectKey: crypto.randomUUID(),
      })
      await expect(fixture.client.query(
        `update messaging_deletion_requests set
          state = 'completed', customer_id = null,
          completed_at = now(), latest_relevant_at = now(),
          prior_record_counts = '{}'::jsonb, proof_summary = '{}'::jsonb,
          retain_until = now()
        where id = $1`,
        [immediateRetentionId],
      )).rejects.toThrow(/messaging_deletion_requests_retention_window_exact/)

      const beforeCompletionId = await insertDeletionRequest(fixture.client, tenant, {
        subjectKey: crypto.randomUUID(),
      })
      await expect(fixture.client.query(
        `update messaging_deletion_requests set
          state = 'completed', customer_id = null,
          completed_at = '2024-03-01 12:00:00+00',
          latest_relevant_at = '2024-02-29 12:00:00+00',
          prior_record_counts = '{}'::jsonb, proof_summary = '{}'::jsonb,
          retain_until = '2029-02-28 12:00:00+00'
        where id = $1`,
        [beforeCompletionId],
      )).rejects.toThrow(/messaging_deletion_requests_retention_window_exact/)
    } finally {
      await fixture.close()
    }
  })

  it('installs stable hold-target serialization before hold insertion or retargeting', async () => {
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
      expect(functionDefinition).toContain(
        'array_agg(distinct r.id order by r.id)',
      )
      expect(functionDefinition).toContain('for update')
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
        'BEFORE INSERT OR UPDATE OF shop_id, resource_type, resource_id, subject_key',
      )

      const tenant = await seedTenant(fixture.client)
      const firstSubject = crypto.randomUUID()
      const secondSubject = crypto.randomUUID()
      await insertDeletionRequest(fixture.client, tenant, { subjectKey: firstSubject })
      await insertDeletionRequest(fixture.client, tenant, { subjectKey: firstSubject })
      const hold = await fixture.client.query<{ id: string }>(
        `insert into messaging_retention_holds (
          shop_id, subject_key, reason_code, authorizing_actor_profile_id,
          starts_at, review_at, expires_at, retain_until
        ) values ($1, $2, 'legal_claim', $3, now(), now() + interval '1 day',
          now() + interval '30 days', now() + interval '5 years')
        returning id`,
        [tenant.shopId, firstSubject, tenant.actorId],
      )
      await fixture.client.query(
        `update messaging_retention_holds
        set subject_key = $1
        where id = $2`,
        [secondSubject, hold.rows[0]?.id],
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
})
