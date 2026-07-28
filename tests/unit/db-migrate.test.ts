import { describe, expect, it } from 'vitest'

// @ts-ignore -- The runner is intentionally Node-only JavaScript with runtime-tested exports.
import { applyRefusalReason, checksum, isMigrationFilename, listMigrationFiles, planMigrations, redactError } from '../../scripts/db-migrate.mjs'

type PlanFile = { name: string; checksum: string }
type Plan = { pending: PlanFile[]; drifted: string[]; missing: string[] }

const plan = planMigrations as (input: {
  files: PlanFile[]
  applied: Record<string, string>
}) => Plan

const file = (name: string, contents: string): PlanFile => ({
  name,
  checksum: (checksum as (value: string) => string)(contents),
})

describe('migration runner', () => {
  it('refuses to apply to a database that has tables but no ledger', () => {
    // The one accident worth engineering out: re-running every migration
    // against a database that already has them.
    expect(applyRefusalReason({ hasLedger: false, hasApplicationTables: true }))
      .toMatch(/baseline/)

    // A brand-new database and an already-recorded one are both fine.
    expect(applyRefusalReason({ hasLedger: false, hasApplicationTables: false })).toBeNull()
    expect(applyRefusalReason({ hasLedger: true, hasApplicationTables: true })).toBeNull()
  })

  it('applies only what the ledger has not recorded, in filename order', () => {
    const files = [file('0001_a.sql', 'a'), file('0002_b.sql', 'b'), file('0003_c.sql', 'c')]
    const result = plan({ files, applied: { '0001_a.sql': files[0].checksum } })

    expect(result.pending.map((entry) => entry.name)).toEqual(['0002_b.sql', '0003_c.sql'])
    expect(result.drifted).toEqual([])
    expect(result.missing).toEqual([])
  })

  it('reports a migration whose contents changed after it was applied', () => {
    // Exactly the 0045 case: an applied file amended in place, which is how the
    // duplicate ticket_activity indexes reached two different migrations.
    const files = [file('0045_ledger.sql', 'create index x; create index fk;')]
    const result = plan({ files, applied: { '0045_ledger.sql': checksum('create index x;') } })

    expect(result.drifted).toEqual(['0045_ledger.sql'])
    expect(result.pending).toEqual([])
  })

  it('reports a migration the database applied that is gone from disk', () => {
    const result = plan({ files: [file('0001_a.sql', 'a')], applied: { '0002_deleted.sql': 'z' } })
    expect(result.missing).toEqual(['0002_deleted.sql'])
  })

  it('accepts only filenames that sort unambiguously by name', () => {
    expect(isMigrationFilename('0048_shop_os_intent_aware_intake.sql')).toBe(true)
    // The two real suffixed migrations still sort after their base number.
    expect(isMigrationFilename('0011a_session_curator_columns.sql')).toBe(true)
    expect(isMigrationFilename('48_late.sql')).toBe(false)
    expect(isMigrationFilename('add_column.sql')).toBe(false)
    expect(isMigrationFilename('0048_Mixed_Case.sql')).toBe(false)
  })

  it('reads this repository’s own migration folder in order', () => {
    const names = (listMigrationFiles as () => string[])()

    expect(names.length).toBeGreaterThan(50)
    expect(names[0]).toMatch(/^0000_/)
    expect(names.at(-1)).toBe('0048_shop_os_intent_aware_intake.sql')
    expect([...names]).toEqual([...names].sort())
    expect(names.indexOf('0011a_session_curator_columns.sql'))
      .toBeGreaterThan(names.findIndex((name) => name.startsWith('0011_')))
  })

  it('never lets a connection string reach the output', () => {
    const redact = redactError as (error: unknown) => string
    expect(redact(new Error('connect postgres://user:hunter2@db.example.com:5432/postgres failed')))
      .toBe('connect postgres://<REDACTED>@db.example.com:5432/postgres failed')
    expect(redact(new Error('DATABASE_URL=postgres://a:b@c/d'))).toBe('DATABASE_URL=<REDACTED>')
  })
})
