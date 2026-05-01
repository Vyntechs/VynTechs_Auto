import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import type * as schema from './schema'
import {
  shops,
  profiles,
  sessions,
  type Shop,
  type NewShop,
  type Profile,
  type NewProfile,
  type Session,
  type NewSession,
} from './schema'

export type AppDb =
  | PostgresJsDatabase<typeof schema>
  | PgliteDatabase<typeof schema>

export async function createShop(db: AppDb, input: NewShop): Promise<Shop> {
  const [shop] = await db.insert(shops).values(input).returning()
  return shop
}

export async function getShopById(db: AppDb, id: string): Promise<Shop | null> {
  const [shop] = await db.select().from(shops).where(eq(shops.id, id)).limit(1)
  return shop ?? null
}

export async function createProfile(db: AppDb, input: NewProfile): Promise<Profile> {
  const [profile] = await db.insert(profiles).values(input).returning()
  return profile
}

export async function getProfileByUserId(db: AppDb, userId: string): Promise<Profile | null> {
  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.user_id, userId))
    .limit(1)
  return profile ?? null
}

export async function createSession(db: AppDb, input: NewSession): Promise<Session> {
  const [session] = await db.insert(sessions).values(input).returning()
  return session
}

export async function getSessionById(db: AppDb, id: string) {
  return db.query.sessions.findFirst({
    where: eq(sessions.id, id),
    with: { shop: true, tech: true },
  })
}
