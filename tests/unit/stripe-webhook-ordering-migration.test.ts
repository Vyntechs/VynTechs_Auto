import { describe, expect, it } from 'vitest'
import { createTestDb, ensureStripeWebhookOrderingMigration } from '../helpers/db'

describe('Stripe webhook ordering migration', () => {
  it('is complete, server-only, and idempotent in the production migration harness', async () => {
    const { client, close } = await createTestDb()
    try {
      await ensureStripeWebhookOrderingMigration(client)
      const result = await client.query<{
        cursor_columns: number
        ledger_columns: number
        rls_enabled: boolean
        policy_count: number
        client_grants: number
        service_crud: number
      }>(`
        select
          (select count(*)::int from information_schema.columns
           where table_schema = 'public' and table_name = 'stripe_customers'
             and column_name in ('last_webhook_event_id', 'last_webhook_event_created'))
            as cursor_columns,
          (select count(*)::int from information_schema.columns
           where table_schema = 'public' and table_name = 'processed_stripe_events')
            as ledger_columns,
          (select relrowsecurity from pg_class
           where oid = 'public.processed_stripe_events'::regclass) as rls_enabled,
          (select count(*)::int from pg_policies
           where schemaname = 'public' and tablename = 'processed_stripe_events'
             and policyname = 'processed_stripe_events_server_only_deny_direct')
            as policy_count,
          (select count(*)::int from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'processed_stripe_events'
             and grantee in ('anon', 'authenticated')) as client_grants,
          (select count(*)::int from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'processed_stripe_events'
             and grantee = 'service_role'
             and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) as service_crud
      `)
      expect(result.rows[0]).toEqual({
        cursor_columns: 2,
        ledger_columns: 6,
        rls_enabled: true,
        policy_count: 1,
        client_grants: 0,
        service_crud: 4,
      })
    } finally {
      await close()
    }
  }, 15_000)
})
