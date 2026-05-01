import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import type * as schema from './schema'
import {
  shops,
  profiles,
  sessions,
  sessionEvents,
  type Shop,
  type NewShop,
  type Profile,
  type NewProfile,
  type Session,
  type NewSession,
  type SessionEvent,
  type NewSessionEvent,
  type TreeState,
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
    .where(eq(profiles.userId, userId))
    .limit(1)
  return profile ?? null
}

export async function createSession(db: AppDb, input: NewSession): Promise<Session> {
  const [session] = await db.insert(sessions).values(input).returning()
  return session
}

export async function ensureProfileAndShop(
  db: AppDb,
  userId: string,
  email: string,
): Promise<Profile> {
  const existing = await getProfileByUserId(db, userId)
  if (existing) return existing
  const [shop] = await db.insert(shops).values({ name: `${email}'s Shop` }).returning()
  const [profile] = await db
    .insert(profiles)
    .values({ userId, role: 'owner', shopId: shop.id })
    .returning()
  return profile
}

export async function getSessionById(db: AppDb, id: string) {
  return db.query.sessions.findFirst({
    where: eq(sessions.id, id),
    with: { shop: true, tech: true },
  })
}

export async function getOpenSessionForTech(
  db: AppDb,
  techId: string,
): Promise<Session | null> {
  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.techId, techId), eq(sessions.status, 'open')))
    .limit(1)
  return session ?? null
}

export async function appendSessionEvent(
  db: AppDb,
  input: NewSessionEvent,
): Promise<SessionEvent> {
  const [event] = await db.insert(sessionEvents).values(input).returning()
  return event
}

export async function updateSessionTreeState(
  db: AppDb,
  sessionId: string,
  treeState: TreeState,
): Promise<void> {
  await db.update(sessions).set({ treeState }).where(eq(sessions.id, sessionId))
}
