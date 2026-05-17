import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { knowledgeItems, knowledgeItemVehicles, type KnowledgeItem } from '@/lib/db/schema'
import type { AppDb } from '@/lib/db/queries'

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

export type KnowledgeListFilter = {
  type?: KnowledgeItem['type']
  dtc?: string
  systemCode?: string
  symptom?: string
  vehicleMake?: string
  vehicleModel?: string
  vehicleYear?: number
  status?: 'active' | 'retired' | 'all'
}

export type KnowledgeListRow = KnowledgeItem & {
  vehicleScopes: Array<{
    yearStart: number
    yearEnd: number
    make: string
    model: string | null
    engine: string | null
    trim: string | null
  }>
}

export async function listKnowledgeItems(
  db: AppDb,
  args: { shopId: string; filter: KnowledgeListFilter; limit?: number },
): Promise<KnowledgeListRow[]> {
  const { shopId, filter, limit = 200 } = args
  const status = filter.status ?? 'active'
  // Cast to ISO string explicitly — the production Postgres driver (node-
  // postgres via postgres-js) rejects raw Date objects in query parameters
  // with TypeError("string argument must be ... Received an instance of Date").
  // Our test DB (PGlite) is forgiving and converts automatically, which hid
  // the bug locally. Crashes /knowledge with a 500 on every shop with active
  // items.
  const cutoff = new Date(Date.now() - TWENTY_FOUR_HOURS_MS).toISOString()

  const conditions = [eq(knowledgeItems.shopId, shopId)]

  if (status === 'active') {
    conditions.push(
      sql`(${knowledgeItems.retired} = false OR ${knowledgeItems.retiredAt} >= ${cutoff})`,
    )
  } else if (status === 'retired') {
    conditions.push(eq(knowledgeItems.retired, true))
  }

  if (filter.type) conditions.push(eq(knowledgeItems.type, filter.type))
  if (filter.dtc) {
    conditions.push(sql`${filter.dtc} = ANY(${knowledgeItems.dtcList})`)
  }
  if (filter.systemCode) {
    conditions.push(sql`${filter.systemCode} = ANY(${knowledgeItems.systemCodes})`)
  }
  if (filter.symptom) {
    conditions.push(sql`${filter.symptom} = ANY(${knowledgeItems.symptoms})`)
  }

  if (filter.vehicleMake || filter.vehicleModel || filter.vehicleYear) {
    const matchingItemIds = await findItemIdsByVehicle(db, {
      shopId,
      make: filter.vehicleMake,
      model: filter.vehicleModel,
      year: filter.vehicleYear,
    })
    if (matchingItemIds.length === 0) return []
    conditions.push(inArray(knowledgeItems.id, matchingItemIds))
  }

  const items = await db
    .select()
    .from(knowledgeItems)
    .where(and(...conditions))
    .orderBy(desc(knowledgeItems.updatedAt))
    .limit(limit)

  if (items.length === 0) return []

  const scopes = await db
    .select()
    .from(knowledgeItemVehicles)
    .where(inArray(knowledgeItemVehicles.knowledgeItemId, items.map(i => i.id)))

  const scopesByItem = new Map<string, KnowledgeListRow['vehicleScopes']>()
  for (const s of scopes) {
    const arr = scopesByItem.get(s.knowledgeItemId) ?? []
    arr.push({
      yearStart: s.yearStart,
      yearEnd: s.yearEnd,
      make: s.make,
      model: s.model,
      engine: s.engine,
      trim: s.trim,
    })
    scopesByItem.set(s.knowledgeItemId, arr)
  }

  return items.map(item => ({
    ...item,
    vehicleScopes: scopesByItem.get(item.id) ?? [],
  }))
}

async function findItemIdsByVehicle(
  db: AppDb,
  args: { shopId: string; make?: string; model?: string; year?: number },
): Promise<string[]> {
  const conds = [eq(knowledgeItems.shopId, args.shopId)]
  if (args.make) conds.push(eq(knowledgeItemVehicles.make, args.make))
  if (args.model) conds.push(eq(knowledgeItemVehicles.model, args.model))
  if (args.year) {
    conds.push(sql`${knowledgeItemVehicles.yearStart} <= ${args.year}`)
    conds.push(sql`${knowledgeItemVehicles.yearEnd} >= ${args.year}`)
  }

  const rows = await db
    .selectDistinct({ id: knowledgeItems.id })
    .from(knowledgeItems)
    .innerJoin(knowledgeItemVehicles, eq(knowledgeItemVehicles.knowledgeItemId, knowledgeItems.id))
    .where(and(...conds))

  return rows.map(r => r.id)
}
