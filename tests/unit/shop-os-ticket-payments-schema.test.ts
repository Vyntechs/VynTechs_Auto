import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { customers, profiles, shops, tickets, ticketPayments, vehicles } from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const TICKET = uuid(20)

describe('ticket_payments schema and server-only ACL', () => {
  let db: TestDb
  let client: Awaited<ReturnType<typeof createTestDb>>['client']
  let close: () => Promise<void>
  let shopId: string

  beforeEach(async () => {
    ;({ db, client, close } = await createTestDb())
    const [shop] = await db.insert(shops).values({ name: 'North' }).returning()
    shopId = shop.id
    await db.insert(profiles).values({ id: uuid(1), userId: uuid(101), shopId, role: 'owner' })
    await db.insert(customers).values({ id: uuid(10), shopId, name: 'C', phone: '5551234567' })
    await db.insert(vehicles).values({ id: uuid(11), customerId: uuid(10), year: 2020, make: 'Ford', model: 'F' })
    await db.insert(tickets).values({
      id: TICKET, shopId, ticketNumber: 7, source: 'counter', customerId: uuid(10),
      vehicleId: uuid(11), concern: 'x', createdByProfileId: uuid(1),
    })
  })

  afterEach(async () => close())

  it('is server-only: RLS on, deny policy, no client grants, service CRUD', async () => {
    const result = await client.query<{
      rls_enabled: boolean
      policy_count: number
      client_grants: number
      service_crud: number
    }>(`
      select
        coalesce((select relrowsecurity from pg_class
          where oid = to_regclass('public.ticket_payments')), false) as rls_enabled,
        (select count(*)::int from pg_policies
         where schemaname = 'public' and tablename = 'ticket_payments'
           and policyname = 'ticket_payments_server_only_deny_direct'
           and roles::text = '{anon,authenticated}'
           and cmd = 'ALL' and qual = 'false' and with_check = 'false') as policy_count,
        (select count(*)::int from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'ticket_payments'
           and grantee in ('anon', 'authenticated')) as client_grants,
        (select count(*)::int from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'ticket_payments'
           and grantee = 'service_role'
           and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) as service_crud
    `)
    expect(result.rows[0]).toEqual({
      rls_enabled: true, policy_count: 1, client_grants: 0, service_crud: 4,
    })
  })

  it('accepts a valid payment row', async () => {
    await expect(db.insert(ticketPayments).values({
      shopId, ticketId: TICKET, amountCents: 5_000, method: 'cash',
      recordedByProfileId: uuid(1), requestKey: uuid(50),
    })).resolves.not.toThrow()
  })

  it('rejects a non-positive amount', async () => {
    await expect(db.insert(ticketPayments).values({
      shopId, ticketId: TICKET, amountCents: 0, method: 'cash',
      recordedByProfileId: uuid(1), requestKey: uuid(51),
    })).rejects.toThrow()
  })

  it('rejects an unknown payment method', async () => {
    await expect(client.exec(`
      insert into ticket_payments (shop_id, ticket_id, amount_cents, method, recorded_by_profile_id, request_key)
      values ('${shopId}', '${TICKET}', 100, 'venmo', '${uuid(1)}', '${uuid(52)}')
    `)).rejects.toThrow()
  })

  it('rejects a duplicate request key within a shop', async () => {
    await db.insert(ticketPayments).values({
      shopId, ticketId: TICKET, amountCents: 100, method: 'cash',
      recordedByProfileId: uuid(1), requestKey: uuid(53),
    })
    await expect(db.insert(ticketPayments).values({
      shopId, ticketId: TICKET, amountCents: 200, method: 'card',
      recordedByProfileId: uuid(1), requestKey: uuid(53),
    })).rejects.toThrow()
  })
})
