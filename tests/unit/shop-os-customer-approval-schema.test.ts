import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '@/tests/helpers/db'

const TOKEN_HASH = 'a'.repeat(64)
const FINGERPRINT = 'b'.repeat(64)

describe('Shop OS customer approval link lifecycle', () => {
  let client: PGlite
  let close: () => Promise<void>
  let shopId: string
  let customerId: string
  let actorId: string
  let vehicleId: string
  let ticketId: string
  let quoteVersionId: string

  beforeEach(async () => {
    ;({ client, close } = await createTestDb())
    shopId = crypto.randomUUID()
    customerId = crypto.randomUUID()
    actorId = crypto.randomUUID()
    vehicleId = crypto.randomUUID()
    ticketId = crypto.randomUUID()
    quoteVersionId = crypto.randomUUID()
    await client.query('insert into shops (id, name) values ($1, $2)', [shopId, 'Approval Shop'])
    await client.query(
      'insert into customers (id, shop_id, name, phone) values ($1, $2, $3, $4)',
      [customerId, shopId, 'Approval Customer', '555-0100'],
    )
    await client.query(
      'insert into profiles (id, user_id, shop_id, full_name) values ($1, $2, $3, $4)',
      [actorId, crypto.randomUUID(), shopId, 'Approval Advisor'],
    )
    await client.query(
      'insert into vehicles (id, customer_id, year, make, model) values ($1, $2, 2020, $3, $4)',
      [vehicleId, customerId, 'Ford', 'F-150'],
    )
    await client.query(
      `insert into tickets (
        id, shop_id, ticket_number, source, customer_id, vehicle_id, concern, created_by_profile_id
      ) values ($1, $2, 1, 'counter', $3, $4, 'Approval concern', $5)`,
      [ticketId, shopId, customerId, vehicleId, actorId],
    )
    await client.query(
      `insert into quote_versions (
        id, shop_id, ticket_id, version_number, snapshot, created_by_profile_id
      ) values ($1, $2, $3, 1, '{}'::jsonb, $4)`,
      [quoteVersionId, shopId, ticketId, actorId],
    )
  })

  afterEach(async () => close())

  async function createLink(overrides: {
    tokenHash?: string
    requestKey?: string
    state?: 'queued' | 'submitted'
  } = {}): Promise<string> {
    const state = overrides.state ?? 'submitted'
    const result = await client.query<{ id: string }>(
      `insert into quote_sends (
        shop_id, ticket_id, quote_version_id, customer_id, subject_key,
        destination_fingerprint, fingerprint_key_version, channel,
        token_hash, token_expires_at, requesting_actor_profile_id,
        request_key, request_fingerprint, state, submitting_at, submitted_at
      ) values (
        $1, $2, $3, $4, $4, $5, 'link_v1', 'link',
        $6, now() + interval '7 days', $7, $8, $9, $10,
        case when $10 = 'submitted' then now() else null end,
        case when $10 = 'submitted' then now() else null end
      ) returning id`,
      [
        shopId,
        ticketId,
        quoteVersionId,
        customerId,
        FINGERPRINT,
        overrides.tokenHash ?? TOKEN_HASH,
        actorId,
        overrides.requestKey ?? crypto.randomUUID(),
        'c'.repeat(64),
        state,
      ],
    )
    return result.rows[0]!.id
  }

  it('accepts an actionable manual link without SMS submission theater', async () => {
    const indexes = await client.query<{ indexname: string }>(`
      select indexname from pg_indexes
      where tablename = 'quote_sends'
        and indexname in (
          'quote_sends_active_link_token_uq',
          'quote_sends_link_request_fingerprint_idx',
          'quote_sends_shop_ticket_version_submitted_link_uq'
        )
      order by indexname
    `)
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'quote_sends_active_link_token_uq',
      'quote_sends_link_request_fingerprint_idx',
      'quote_sends_shop_ticket_version_submitted_link_uq',
    ])
    const id = await createLink()
    const result = await client.query<{
      channel: string
      state: string
      submitting_at: Date | null
      submitted_at: Date | null
    }>('select channel, state, submitting_at, submitted_at from quote_sends where id = $1', [id])
    expect(result.rows).toEqual([{
      channel: 'link',
      state: 'submitted',
      submitting_at: expect.any(Date),
      submitted_at: expect.any(Date),
    }])
  })

  it('rejects a queued manual link before it can enter the SMS provider lifecycle', async () => {
    await expect(createLink({ state: 'queued' })).rejects.toThrow(/quote_sends_link_state_consistent/)
  })

  it('rejects an actionable manual link without bearer material', async () => {
    await expect(client.query(
      `insert into quote_sends (
        shop_id, ticket_id, quote_version_id, customer_id, subject_key,
        destination_fingerprint, fingerprint_key_version, channel,
        token_hash, token_expires_at, requesting_actor_profile_id,
        request_key, request_fingerprint, state, submitting_at, submitted_at
      ) values (
        $1, $2, $3, $4, $4, $5, 'link_v1', 'link',
        null, null, $6, $7, $8, 'submitted', now(), now()
      )`,
      [shopId, ticketId, quoteVersionId, customerId, FINGERPRINT, actorId,
        crypto.randomUUID(), 'c'.repeat(64)],
    )).rejects.toThrow(/quote_sends_link_state_consistent/)
  })

  it('rejects submitted-to-delivered for a manual link', async () => {
    const id = await createLink()
    await expect(client.query(
      `update quote_sends set state = 'delivered' where id = $1`,
      [id],
    )).rejects.toThrow(/quote_sends_link_state_consistent/)
  })

  it('allows only one actionable manual link for one exact quote version', async () => {
    await createLink()
    await expect(createLink({
      tokenHash: 'd'.repeat(64),
      requestKey: crypto.randomUUID(),
    })).rejects.toThrow(/quote_sends_shop_ticket_version_submitted_link_uq/)
  })

  it('moves an actionable manual link directly to a token-free terminal response', async () => {
    const id = await createLink()
    await client.query(
      `update quote_sends set state = 'responded', token_hash = null,
        token_expires_at = null, terminal_at = now(),
        retain_until = now() + interval '1 year'
      where id = $1`,
      [id],
    )
    const result = await client.query<{
      state: string
      token_hash: string | null
      token_expires_at: Date | null
      submitting_at: Date | null
      submitted_at: Date | null
    }>(
      `select state, token_hash, token_expires_at, submitting_at, submitted_at
      from quote_sends where id = $1`,
      [id],
    )
    expect(result.rows).toEqual([{
      state: 'responded',
      token_hash: null,
      token_expires_at: null,
      submitting_at: expect.any(Date),
      submitted_at: expect.any(Date),
    }])
  })

  it('keeps SMS rows on the provider lifecycle', async () => {
    const result = await client.query<{ id: string }>(
      `insert into quote_sends (
        shop_id, ticket_id, quote_version_id, customer_id, subject_key,
        destination_fingerprint, fingerprint_key_version, channel,
        token_hash, token_expires_at, requesting_actor_profile_id,
        request_key, request_fingerprint, state
      ) values (
        $1, $2, $3, $4, $4, $5, 'key_v1', 'sms',
        $6, now() + interval '7 days', $7, $8, $9, 'queued'
      ) returning id`,
      [shopId, ticketId, quoteVersionId, customerId, FINGERPRINT, TOKEN_HASH,
        actorId, crypto.randomUUID(), 'c'.repeat(64)],
    )
    await expect(client.query(
      `update quote_sends set state = 'responded', token_hash = null,
        token_expires_at = null, terminal_at = now(),
        retain_until = now() + interval '1 year'
      where id = $1`,
      [result.rows[0]!.id],
    )).rejects.toThrow(/invalid quote send state transition|submission_timestamps_consistent/)
  })
})
