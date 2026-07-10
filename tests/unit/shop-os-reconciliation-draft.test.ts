import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'

const IDS = {
  shop: '00000000-0000-0000-0000-000000000001',
  owner: '00000000-0000-0000-0000-000000000002',
  tech: '00000000-0000-0000-0000-000000000003',
  customer: '00000000-0000-0000-0000-000000000004',
  vehicle: '00000000-0000-0000-0000-000000000005',
  repairOrder: '00000000-0000-0000-0000-000000000006',
  session: '00000000-0000-0000-0000-000000000007',
  platform: '00000000-0000-0000-0000-000000000008',
} as const

const openDatabases: PGlite[] = []

afterEach(async () => {
  await Promise.all(openDatabases.splice(0).map((db) => db.close()))
})

async function readDraft(name: 'forward' | 'rollback'): Promise<string> {
  return readFile(
    path.join(
      process.cwd(),
      'docs/strategy/sql',
      `2026-07-10-shop-os-reconciliation-${name}.sql`,
    ),
    'utf8',
  )
}

async function createLegacyDb(): Promise<PGlite> {
  const db = new PGlite()
  openDatabases.push(db)

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;

    create table shops (
      id uuid primary key,
      name text not null,
      created_at timestamptz not null default now(),
      shop_mgmt_enabled boolean not null default false
    );

    create table profiles (
      id uuid primary key,
      user_id uuid not null unique,
      shop_id uuid references shops(id),
      full_name text,
      role text not null default 'tech',
      deactivated_at timestamptz,
      created_at timestamptz not null default now()
    );

    create table customers (
      id uuid primary key,
      shop_id uuid not null references shops(id) on delete cascade,
      name text not null,
      phone text not null,
      email text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      preferred_channel text default 'sms',
      opt_ins jsonb default '{}'::jsonb
    );

    create table platforms (id uuid primary key);

    create table vehicles (
      id uuid primary key,
      customer_id uuid not null references customers(id) on delete cascade,
      year integer not null,
      make text not null,
      model text not null,
      engine text,
      vin text,
      mileage integer,
      plate text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      platform_id uuid references platforms(id) on delete set null,
      diesel_context jsonb
    );

    create table repair_orders (
      id uuid primary key default gen_random_uuid(),
      shop_id uuid not null references shops(id) on delete cascade,
      customer_id uuid not null references customers(id) on delete restrict,
      vehicle_id uuid not null references vehicles(id) on delete restrict,
      status text not null default 'open',
      opened_by uuid not null references profiles(id) on delete restrict,
      opened_at timestamptz not null default now(),
      closed_at timestamptz,
      updated_at timestamptz not null default now()
    );

    create table sessions (
      id uuid primary key,
      shop_id uuid not null references shops(id),
      tech_id uuid not null references profiles(id),
      vehicle_id uuid references vehicles(id),
      status text not null default 'open',
      intake jsonb not null,
      tree_state jsonb not null,
      outcome jsonb,
      created_at timestamptz not null default now(),
      closed_at timestamptz,
      repair_order_id uuid,
      customer_authorized boolean,
      constraint sessions_repair_order_id_repair_orders_id_fk
        foreign key (repair_order_id) references repair_orders(id) on delete set null
    );

    create table work_orders (
      id uuid primary key default gen_random_uuid(),
      customer_id uuid not null references customers(id) on delete restrict,
      vehicle_id uuid not null references vehicles(id) on delete restrict,
      state text not null default 'draft',
      ticket_type text not null default 'customer-pay',
      promise_date timestamptz,
      priority text not null default 'normal',
      writer_id uuid references profiles(id) on delete set null,
      tech_id uuid references profiles(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table concerns (
      id uuid primary key default gen_random_uuid(),
      work_order_id uuid not null references work_orders(id) on delete cascade,
      complaint text not null,
      cause text,
      correction text,
      state text not null default 'open',
      position integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table line_items (
      id uuid primary key default gen_random_uuid(),
      concern_id uuid not null references concerns(id) on delete cascade,
      description text not null,
      qty numeric(10, 3) not null,
      unit_price numeric(12, 2) not null,
      source text not null default 'writer-added',
      purpose text not null default 'repair',
      total numeric(12, 2) not null,
      created_at timestamptz not null default now()
    );

    create table authorizations (
      id uuid primary key default gen_random_uuid(),
      work_order_id uuid not null references work_orders(id) on delete cascade,
      auth_type text not null,
      amount_cap numeric(12, 2),
      time_cap_hours numeric(6, 2),
      method text not null,
      captured_at timestamptz not null default now(),
      captured_by text not null,
      signature_image_url text,
      conditions text
    );

    create table outbound_messages (
      id uuid primary key default gen_random_uuid(),
      work_order_id uuid not null references work_orders(id) on delete cascade,
      touchpoint text not null,
      channel text not null,
      status text not null default 'scheduled',
      scheduled_at timestamptz not null default now(),
      sent_at timestamptz,
      template_id text,
      body text not null
    );

    alter table repair_orders enable row level security;
    alter table work_orders enable row level security;
    alter table concerns enable row level security;
    alter table line_items enable row level security;
    alter table authorizations enable row level security;
    alter table outbound_messages enable row level security;

    insert into shops (id, name, shop_mgmt_enabled)
    values ('${IDS.shop}', 'Fixture Shop', true);

    insert into profiles (id, user_id, shop_id, full_name, role)
    values
      ('${IDS.owner}', '10000000-0000-0000-0000-000000000002', '${IDS.shop}', 'Owner', 'owner'),
      ('${IDS.tech}', '10000000-0000-0000-0000-000000000003', '${IDS.shop}', 'Tech', 'tech');

    insert into customers (id, shop_id, name, phone, email)
    values ('${IDS.customer}', '${IDS.shop}', 'Fixture Customer', '5550000000', null);

    insert into platforms (id) values ('${IDS.platform}');

    insert into vehicles (id, customer_id, year, make, model, platform_id)
    values ('${IDS.vehicle}', '${IDS.customer}', 2018, 'Ford', 'F-150', '${IDS.platform}');

    insert into repair_orders (
      id, shop_id, customer_id, vehicle_id, status, opened_by, opened_at, updated_at
    ) values (
      '${IDS.repairOrder}', '${IDS.shop}', '${IDS.customer}', '${IDS.vehicle}',
      'open', '${IDS.owner}', '2026-05-17T13:49:21Z', '2026-05-17T14:00:00Z'
    );

    insert into sessions (
      id, shop_id, tech_id, vehicle_id, status, intake, tree_state,
      created_at, repair_order_id, customer_authorized
    ) values (
      '${IDS.session}', '${IDS.shop}', '${IDS.tech}', '${IDS.vehicle}', 'open',
      '{"vehicleYear":2018,"vehicleMake":"Ford","vehicleModel":"F-150","customerComplaint":"Intermittent no-start"}'::jsonb,
      '{"nodes":[{"id":"seed"}],"currentNodeId":"seed","message":""}'::jsonb,
      '2026-05-17T13:50:00Z', '${IDS.repairOrder}', null
    );

    -- Supabase existing projects can auto-grant new public tables. Apply the
    -- default only after the predecessor fixture exists so rollback must
    -- explicitly restore its observed no-DML grant posture.
    alter default privileges in schema public
      grant select, insert, update, delete on tables to anon, authenticated, service_role;
  `)

  return db
}

async function tableExists(db: PGlite, table: string): Promise<boolean> {
  const result = await db.query<{ name: string | null }>(
    'select to_regclass($1)::text as name',
    [`public.${table}`],
  )
  return result.rows[0]?.name !== null
}

async function columnExists(db: PGlite, table: string, column: string): Promise<boolean> {
  const result = await db.query<{ exists: boolean }>(
    `select exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name=$1 and column_name=$2
     )`,
    [table, column],
  )
  return result.rows[0]?.exists ?? false
}

async function expectForwardFailure(db: PGlite, code: string): Promise<void> {
  await expect(db.exec(await readDraft('forward'))).rejects.toThrow(code)
  await db.exec('rollback').catch(() => undefined)
  expect(await tableExists(db, 'tickets')).toBe(false)
}

describe('Shop OS Phase-0 reconciliation SQL drafts', () => {
  it('migrates the linked repair order into a tenant-safe canonical ticket and job', async () => {
    const db = await createLegacyDb()

    await db.exec(await readDraft('forward'))

    const ticket = await db.query<{
      id: string
      shop_id: string
      customer_id: string
      vehicle_id: string
      ticket_number: number
      source: string
      concern: string
      created_by_profile_id: string
      status: string
    }>('select * from tickets')
    expect(ticket.rows).toEqual([
      expect.objectContaining({
        id: IDS.repairOrder,
        shop_id: IDS.shop,
        customer_id: IDS.customer,
        vehicle_id: IDS.vehicle,
        ticket_number: 1,
        source: 'legacy_repair_order',
        concern: 'Intermittent no-start',
        created_by_profile_id: IDS.owner,
        status: 'open',
      }),
    ])

    const job = await db.query<{
      shop_id: string
      ticket_id: string
      kind: string
      assigned_tech_id: string
      session_id: string
      work_status: string
      approval_state: string
      diagnostic_start_state: string
    }>('select * from ticket_jobs')
    expect(job.rows).toEqual([
      expect.objectContaining({
        shop_id: IDS.shop,
        ticket_id: IDS.repairOrder,
        kind: 'diagnostic',
        assigned_tech_id: IDS.tech,
        session_id: IDS.session,
        work_status: 'in_progress',
        approval_state: 'pending_quote',
        diagnostic_start_state: 'ready',
      }),
    ])

    const shop = await db.query<{ next_ticket_number: number }>(
      'select next_ticket_number from shops where id=$1',
      [IDS.shop],
    )
    expect(shop.rows[0]?.next_ticket_number).toBe(2)

    for (const table of [
      'repair_orders',
      'work_orders',
      'concerns',
      'line_items',
      'authorizations',
      'outbound_messages',
    ]) {
      expect(await tableExists(db, table)).toBe(false)
    }
    expect(await columnExists(db, 'shops', 'shop_mgmt_enabled')).toBe(false)
    expect(await columnExists(db, 'sessions', 'repair_order_id')).toBe(false)
    expect(await columnExists(db, 'sessions', 'customer_authorized')).toBe(false)
    expect(await columnExists(db, 'customers', 'preferred_channel')).toBe(false)
    expect(await columnExists(db, 'customers', 'opt_ins')).toBe(false)
    expect(await columnExists(db, 'vehicles', 'diesel_context')).toBe(false)
    expect(await columnExists(db, 'vehicles', 'platform_id')).toBe(true)

    const security = await db.query<{ relrowsecurity: boolean; policies: number }>(`
      select c.relrowsecurity,
             (select count(*)::int from pg_policies p where p.tablename=c.relname) as policies
      from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('tickets','ticket_jobs')
      order by c.relname
    `)
    expect(security.rows).toEqual([
      { relrowsecurity: true, policies: 1 },
      { relrowsecurity: true, policies: 1 },
    ])

    const grants = await db.query<{ anon_select: boolean; authenticated_insert: boolean }>(`
      select has_table_privilege('anon', 'tickets', 'select') as anon_select,
             has_table_privilege('authenticated', 'ticket_jobs', 'insert') as authenticated_insert
    `)
    expect(grants.rows[0]).toEqual({ anon_select: false, authenticated_insert: false })
  })

  it('refuses to reconcile when any v2 table contains data', async () => {
    const db = await createLegacyDb()
    await db.exec(`
      insert into work_orders (id, customer_id, vehicle_id)
      values ('20000000-0000-0000-0000-000000000001', '${IDS.customer}', '${IDS.vehicle}')
    `)
    await expectForwardFailure(db, 'shop_os_reconciliation:v2_tables_not_empty')
  })

  it('refuses to reinterpret channel defaults as customer consent', async () => {
    const db = await createLegacyDb()
    await db.exec(`update customers set opt_ins='{"sms":true}'::jsonb where id='${IDS.customer}'`)
    await expectForwardFailure(db, 'shop_os_reconciliation:customer_fields_not_default')
  })

  it('refuses a nullable opt-in drift that rollback could not reproduce exactly', async () => {
    const db = await createLegacyDb()
    await db.exec(`update customers set opt_ins=null where id='${IDS.customer}'`)
    await expectForwardFailure(db, 'shop_os_reconciliation:customer_fields_not_default')
  })

  it('refuses to discard non-null diesel context or legacy authorization', async () => {
    const db = await createLegacyDb()
    await db.exec(`update vehicles set diesel_context='{"fuel":"diesel"}'::jsonb where id='${IDS.vehicle}'`)
    await expectForwardFailure(db, 'shop_os_reconciliation:legacy_fields_not_empty')
  })

  it('refuses cross-tenant or structurally ambiguous repair-order links', async () => {
    const db = await createLegacyDb()
    await db.exec(`
      insert into shops (id, name) values ('20000000-0000-0000-0000-000000000002', 'Other Shop');
      update repair_orders set shop_id='20000000-0000-0000-0000-000000000002'
      where id='${IDS.repairOrder}';
    `)
    await expectForwardFailure(db, 'shop_os_reconciliation:invalid_legacy_links')
  })

  it('refuses an unlinked repair order', async () => {
    const db = await createLegacyDb()
    await db.exec(`update sessions set repair_order_id=null where id='${IDS.session}'`)
    await expectForwardFailure(db, 'shop_os_reconciliation:repair_order_session_count')
  })

  it('refuses multiple sessions linked to one repair order', async () => {
    const db = await createLegacyDb()
    await db.exec(`
      insert into sessions (
        id, shop_id, tech_id, vehicle_id, status, intake, tree_state,
        created_at, repair_order_id, customer_authorized
      ) values (
        '20000000-0000-0000-0000-000000000003', '${IDS.shop}', '${IDS.tech}',
        '${IDS.vehicle}', 'open',
        '{"vehicleYear":2018,"vehicleMake":"Ford","vehicleModel":"F-150","customerComplaint":"Second link"}'::jsonb,
        '{"nodes":[{"id":"seed"}],"currentNodeId":"seed","message":""}'::jsonb,
        '2026-05-17T13:51:00Z', '${IDS.repairOrder}', null
      )
    `)
    await expectForwardFailure(db, 'shop_os_reconciliation:repair_order_session_count')
  })

  it('restores the exact predecessor identity and schema before canonical writes begin', async () => {
    const db = await createLegacyDb()
    await db.exec(await readDraft('forward'))
    await db.exec(await readDraft('rollback'))

    const repairOrder = await db.query<{
      id: string
      shop_id: string
      customer_id: string
      vehicle_id: string
      opened_by: string
      status: string
    }>('select * from repair_orders')
    expect(repairOrder.rows).toEqual([
      expect.objectContaining({
        id: IDS.repairOrder,
        shop_id: IDS.shop,
        customer_id: IDS.customer,
        vehicle_id: IDS.vehicle,
        opened_by: IDS.owner,
        status: 'open',
      }),
    ])

    const session = await db.query<{ repair_order_id: string; customer_authorized: boolean | null }>(
      'select repair_order_id, customer_authorized from sessions where id=$1',
      [IDS.session],
    )
    expect(session.rows[0]).toEqual({ repair_order_id: IDS.repairOrder, customer_authorized: null })

    expect(await tableExists(db, 'tickets')).toBe(false)
    expect(await tableExists(db, 'ticket_jobs')).toBe(false)
    expect(await columnExists(db, 'shops', 'next_ticket_number')).toBe(false)
    expect(await columnExists(db, 'profiles', 'skill_tier')).toBe(false)
    expect(await columnExists(db, 'vehicles', 'platform_id')).toBe(true)
    expect(await columnExists(db, 'vehicles', 'diesel_context')).toBe(true)

    for (const table of ['work_orders', 'concerns', 'line_items', 'authorizations', 'outbound_messages']) {
      expect(await tableExists(db, table)).toBe(true)
      const rows = await db.query<{ count: string }>(`select count(*)::text as count from ${table}`)
      expect(rows.rows[0]?.count).toBe('0')
    }

    const grants = await db.query<{ service_select: boolean }>(`
      select has_table_privilege('service_role', 'repair_orders', 'select') as service_select
    `)
    expect(grants.rows[0]?.service_select).toBe(false)
  })

  it('blocks rollback after a non-legacy canonical ticket is written', async () => {
    const db = await createLegacyDb()
    await db.exec(await readDraft('forward'))
    await db.exec(`
      insert into tickets (
        shop_id, ticket_number, source, customer_id, vehicle_id, concern,
        status, created_by_profile_id
      ) values (
        '${IDS.shop}', 2, 'counter', '${IDS.customer}', '${IDS.vehicle}',
        'New work', 'open', '${IDS.owner}'
      )
    `)

    await expect(db.exec(await readDraft('rollback'))).rejects.toThrow(
      'shop_os_reconciliation:canonical_writes_present',
    )
    await db.exec('rollback').catch(() => undefined)
    expect(await tableExists(db, 'tickets')).toBe(true)
    expect(await tableExists(db, 'repair_orders')).toBe(false)
  })
})
