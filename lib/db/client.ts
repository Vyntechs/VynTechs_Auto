import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const isDev = process.env.NODE_ENV !== 'production'
const connectionString =
  (isDev && process.env.DATABASE_URL_DIRECT) || process.env.DATABASE_URL!

const queryClient = postgres(connectionString, { prepare: false })

export const db = drizzle(queryClient, { schema })
export type Database = typeof db
