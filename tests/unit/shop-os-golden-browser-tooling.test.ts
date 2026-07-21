import { describe, expect, it } from 'vitest'

// @ts-ignore -- The executable is intentionally Node-only JavaScript with runtime-tested exports.
import { CLEANUP_TABLES, QA_SHOP_ID, QA_SHOP_NAME, QA_SUPABASE_PUBLISHABLE_KEY, QA_SUPABASE_URL, QA_USERS, cleanupReplicationGuard, cleanupStatements, parseEnvFile, qaIdentityKey, redactError, validateBaseUrl } from '../../scripts/shop-os-golden-browser.mjs'

type QaUser = { email: string; profileId: string; role: string; skillTier: number | null }
type CleanupStatement = { table: string; sql: string; values: string[] }

describe('Golden browser QA control', () => {
  it('uses one fixed synthetic shop and both technicians needed for Chaos Shop Day', () => {
    const users = Object.values(QA_USERS as Record<string, QaUser>)

    expect(QA_SHOP_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(QA_SHOP_NAME).toBe('Vyntechs Golden Browser QA')
    expect(users.map((user) => user.role)).toEqual([
      'owner',
      'advisor',
      'tech',
      'tech',
      'parts',
    ])
    expect(users.every((user) => user.email.endsWith('.invalid'))).toBe(true)
    expect(QA_USERS.tech.skillTier).toBe(3)
    expect(QA_USERS.relief.skillTier).toBe(3)
    expect(QA_USERS.owner.skillTier).toBeNull()
    expect(new Set(users.map(qaIdentityKey))).toHaveLength(users.length)
  })

  it('uses only browser-public Supabase configuration for QA auth provisioning', () => {
    expect(QA_SUPABASE_URL).toBe('https://ynmtszuybeenjbigxdyl.supabase.co')
    expect(QA_SUPABASE_PUBLISHABLE_KEY).toMatch(/^sb_publishable_/)
    expect(QA_SUPABASE_PUBLISHABLE_KEY).not.toMatch(/service_role/i)
  })

  it('parses a Vercel env file without evaluating its contents', () => {
    const parsed = parseEnvFile([
      'DATABASE_URL="postgres://example.test/db?sslmode=require"',
      "NEXT_PUBLIC_SUPABASE_URL='https://project.supabase.co'",
      'SUPABASE_SERVICE_ROLE_KEY=service-role-value',
      'IGNORED=$(touch /tmp/never-run)',
      '# comment',
    ].join('\n'))

    expect(parsed.DATABASE_URL).toBe('postgres://example.test/db?sslmode=require')
    expect(parsed.NEXT_PUBLIC_SUPABASE_URL).toBe('https://project.supabase.co')
    expect(parsed.SUPABASE_SERVICE_ROLE_KEY).toBe('service-role-value')
    expect(parsed.IGNORED).toBe('$(touch /tmp/never-run)')
  })

  it('redacts credential-shaped values from failures', () => {
    const message = redactError(new Error(
      'password=secret-value SUPABASE_SERVICE_ROLE_KEY=role-value postgres://user:pass@example.test/db',
    ))

    expect(message).not.toContain('secret-value')
    expect(message).not.toContain('role-value')
    expect(message).not.toContain('user:pass')
    expect(message).toContain('<REDACTED>')
  })

  it('keeps every cleanup statement bound to the fixed QA shop', () => {
    expect(CLEANUP_TABLES).toEqual([
      'ticket_activity',
      'ticket_payments',
      'quote_events',
      'job_part_requests',
      'job_lines',
      'ticket_jobs',
      'quote_versions',
      'tickets',
      'vehicles',
      'customers',
    ])

    const statements = cleanupStatements(QA_SHOP_ID) as CleanupStatement[]
    expect(statements).toHaveLength(CLEANUP_TABLES.length)
    for (const statement of statements) {
      expect(statement.sql).toContain('$1')
      expect(statement.values).toEqual([QA_SHOP_ID])
      expect(statement.sql).not.toContain('profiles')
      expect(statement.sql).not.toContain('shops')
      expect(statement.sql).not.toContain('auth.')
    }
    expect(statements.find((statement) => statement.table === 'vehicles')?.sql)
      .toContain('select id from public.customers where shop_id = $1')
  })

  it('bypasses immutable-ledger triggers only inside the cleanup transaction', () => {
    expect(cleanupReplicationGuard()).toEqual({
      enter: 'set local session_replication_role = replica',
      exit: 'set local session_replication_role = origin',
    })
    expect(Object.values(cleanupReplicationGuard()).join(' ')).not.toMatch(/alter table|disable trigger/i)
  })

  it('accepts production and explicit localhost only', () => {
    expect(validateBaseUrl('https://vyntechs.dev', false)).toBe('https://vyntechs.dev')
    expect(() => validateBaseUrl('http://localhost:3000', false)).toThrow(/ALLOW_LOCALHOST/)
    expect(validateBaseUrl('http://localhost:3000', true)).toBe('http://localhost:3000')
    expect(() => validateBaseUrl('https://example.com', true)).toThrow(/vyntechs/i)
  })

  it('accepts only an explicitly enabled Vyntechs preview deployment', () => {
    const preview = 'https://vyntechs-golden-shop-day-brandon-nichols-projects-f7e6d2a9.vercel.app'
    expect(() => validateBaseUrl(preview, false, false)).toThrow(/Vyntechs/i)
    expect(validateBaseUrl(preview, false, true)).toBe(preview)
    expect(() => validateBaseUrl('https://unrelated-project.vercel.app', false, true)).toThrow(/Vyntechs/i)
  })
})
