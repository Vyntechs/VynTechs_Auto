import { describe, expect, it } from 'vitest'
import { createTestDb, ensureJobTimerPreferenceMigration } from '@/tests/helpers/db'

describe('job timer preference migration', () => {
  it('adds a non-null default-off preference to every profile', async () => {
    const fixture = await createTestDb()
    try {
      const column = await fixture.client.query<{
        is_nullable: string
        column_default: string | null
      }>(`
        select is_nullable, column_default
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'profiles'
          and column_name = 'job_timer_enabled'
      `)

      expect(column.rows).toEqual([{
        is_nullable: 'NO',
        column_default: 'false',
      }])

      await fixture.client.query(`
        insert into profiles (user_id)
        values ('00000000-0000-4000-8000-000000000049')
      `)
      const saved = await fixture.client.query<{ job_timer_enabled: boolean }>(`
        select job_timer_enabled
        from profiles
        where user_id = '00000000-0000-4000-8000-000000000049'
      `)
      expect(saved.rows).toEqual([{ job_timer_enabled: false }])

      await ensureJobTimerPreferenceMigration(fixture.client)
      expect((await fixture.client.query(`
        select job_timer_enabled
        from profiles
        where user_id = '00000000-0000-4000-8000-000000000049'
      `)).rows).toEqual([{ job_timer_enabled: false }])
    } finally {
      await fixture.close()
    }
  })
})
