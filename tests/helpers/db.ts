import { PGlite } from '@electric-sql/pglite'
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import path from 'node:path'
import * as schema from '@/lib/db/schema'

export type TestDb = PgliteDatabase<typeof schema>

export async function createTestDb(): Promise<{
  db: TestDb
  close: () => Promise<void>
}> {
  const client = new PGlite()
  const db = drizzle(client, { schema })
  await migrate(db, {
    migrationsFolder: path.join(process.cwd(), 'drizzle/migrations'),
  })
  return {
    db,
    close: async () => {
      await client.close()
    },
  }
}
