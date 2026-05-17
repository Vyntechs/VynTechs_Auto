import { sql, type SQL } from 'drizzle-orm'
import { normalizeDtc, normalizeEngine } from '@/lib/knowledge/normalize'
import type { AppDb } from '@/lib/db/queries'

export type RetrievalVehicle = {
  year: number
  make: string
  model: string
  engine?: string
}

export type KnowledgeItemType =
  | 'cause_fix'
  | 'reference_doc'
  | 'bulletin'
  | 'note'
  | 'pinout'
  | 'connector'
  | 'wiring_diagram'
  | 'theory_of_operation'

export type MatchedKnowledgeItem = {
  id: string
  shopId: string
  type: KnowledgeItemType
  title: string
  body: string | null
  structuredData: Record<string, unknown> | null
  dtcList: string[]
  systemCodes: string[]
  symptoms: string[]
  fireCount: number
  score: number
}

export type LookupKnowledgeInput = {
  shopId: string
  vehicle: RetrievalVehicle
  dtcs?: string[]
  systemCodes?: string[]
  symptoms?: string[]
  typeFilter?: KnowledgeItemType
  limit?: number
}

// Postgres array literal builder. Drizzle's `sql` template interpolates JS
// arrays as a row constructor; the `&&` overlap operator needs a real
// text[]. Inputs are caller-supplied (DTC strings etc.); we escape single
// quotes defensively. Matches the helper in tests/unit/knowledge-scoring.test.ts.
function arrayLit(arr: string[]): SQL {
  const elements = arr.map((s) => `'${s.replace(/'/g, "''")}'`).join(',')
  return sql.raw(`ARRAY[${elements}]::text[]`)
}

// Use AppDb (PgliteDatabase | PostgresJsDatabase) so production callers
// and PGlite test setups share the same type without casting.
export type RetrievalDb = AppDb

// PGlite returns `Results<T>` with a `.rows` property; postgres-js returns
// `T[]` directly. The unwrap handles both shapes — pattern lifted from
// tests/unit/knowledge-scoring.test.ts (PR 1).
function rows<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[]
  const r = (res as { rows?: T[] }).rows
  return r ?? []
}

type Row = {
  id: string
  shop_id: string
  type: KnowledgeItemType
  title: string
  body: string | null
  structured_data: Record<string, unknown> | null
  dtc_list: string[]
  system_codes: string[]
  symptoms: string[]
  fire_count: number
  score: number
}

function toMatched(r: Row): MatchedKnowledgeItem {
  return {
    id: r.id,
    shopId: r.shop_id,
    type: r.type,
    title: r.title,
    body: r.body,
    structuredData: r.structured_data,
    dtcList: r.dtc_list,
    systemCodes: r.system_codes,
    symptoms: r.symptoms,
    fireCount: r.fire_count,
    score: r.score,
  }
}

export async function lookupKnowledge(
  db: RetrievalDb,
  input: LookupKnowledgeInput,
): Promise<MatchedKnowledgeItem[]> {
  const normalizedDtcs = (input.dtcs ?? [])
    .map((d) => normalizeDtc(d))
    .filter((d): d is string => d !== null)
  const dtcs = arrayLit(normalizedDtcs)
  const systems = arrayLit(input.systemCodes ?? [])
  const symptoms = arrayLit(input.symptoms ?? [])
  const limit = input.limit ?? 3
  const normalizedEngine = normalizeEngine(input.vehicle.engine ?? null)
  const typeFilter = input.typeFilter ?? null

  const res = await db.execute(sql`
    SELECT items.id, items.shop_id, items.type, items.title, items.body,
      items.structured_data, items.dtc_list, items.system_codes, items.symptoms,
      items.fire_count,
      ((CASE WHEN items.dtc_list && ${dtcs} THEN 100 ELSE 0 END) +
       (CASE WHEN items.system_codes && ${systems} THEN 25 ELSE 0 END) +
       (CASE WHEN items.symptoms && ${symptoms} THEN 25 ELSE 0 END))
      AS score
    FROM knowledge_items items
    JOIN knowledge_item_vehicles v ON v.knowledge_item_id = items.id
    WHERE items.shop_id = ${input.shopId}
      AND items.retired = false
      AND v.make = ${input.vehicle.make}
      AND (v.model IS NULL OR v.model = ${input.vehicle.model})
      AND (v.engine IS NULL OR v.engine = ${normalizedEngine} OR v.engine = ${input.vehicle.engine ?? null})
      AND ${input.vehicle.year}::int BETWEEN v.year_start AND v.year_end
      AND (${typeFilter}::text IS NULL OR items.type = ${typeFilter})
      AND (
        items.dtc_list && ${dtcs}
        OR items.system_codes && ${systems}
        OR items.symptoms && ${symptoms}
      )
    ORDER BY score DESC, items.fire_count DESC, items.updated_at DESC
    LIMIT ${limit}
  `)
  return rows<Row>(res).map(toMatched)
}

// Shared vehicle-scope WHERE clause used by every specialized fn. Inlined
// per call because Drizzle sql templates don't compose cleanly as
// sub-fragments here — kept readable by extracting only the input.
function vehicleScopeFragment(vehicle: RetrievalVehicle): {
  make: SQL
  model: SQL
  engine: SQL
  year: SQL
} {
  const normalizedEngine = normalizeEngine(vehicle.engine ?? null)
  return {
    make: sql`v.make = ${vehicle.make}`,
    model: sql`(v.model IS NULL OR v.model = ${vehicle.model})`,
    engine: sql`(v.engine IS NULL OR v.engine = ${normalizedEngine} OR v.engine = ${vehicle.engine ?? null})`,
    year: sql`${vehicle.year}::int BETWEEN v.year_start AND v.year_end`,
  }
}

export type GetConnectorPinoutInput = {
  shopId: string
  connectorRef: string
  vehicle: RetrievalVehicle
  limit?: number
}

export async function getConnectorPinout(
  db: RetrievalDb,
  input: GetConnectorPinoutInput,
): Promise<MatchedKnowledgeItem[]> {
  const limit = input.limit ?? 3
  const v = vehicleScopeFragment(input.vehicle)
  const res = await db.execute(sql`
    SELECT items.id, items.shop_id, items.type, items.title, items.body,
      items.structured_data, items.dtc_list, items.system_codes, items.symptoms,
      items.fire_count, 0::int AS score
    FROM knowledge_items items
    JOIN knowledge_item_vehicles v ON v.knowledge_item_id = items.id
    WHERE items.shop_id = ${input.shopId}
      AND items.retired = false
      AND items.type = 'pinout'
      AND items.structured_data->>'connector_ref' = ${input.connectorRef}
      AND ${v.make}
      AND ${v.model}
      AND ${v.engine}
      AND ${v.year}
    ORDER BY items.fire_count DESC, items.updated_at DESC
    LIMIT ${limit}
  `)
  return rows<Row>(res).map(toMatched)
}

export type GetTheoryOfOperationInput = {
  shopId: string
  systemCode: string
  vehicle: RetrievalVehicle
  limit?: number
}

export async function getTheoryOfOperation(
  db: RetrievalDb,
  input: GetTheoryOfOperationInput,
): Promise<MatchedKnowledgeItem[]> {
  const limit = input.limit ?? 3
  const v = vehicleScopeFragment(input.vehicle)
  const systems = arrayLit([input.systemCode])
  const res = await db.execute(sql`
    SELECT items.id, items.shop_id, items.type, items.title, items.body,
      items.structured_data, items.dtc_list, items.system_codes, items.symptoms,
      items.fire_count, 0::int AS score
    FROM knowledge_items items
    JOIN knowledge_item_vehicles v ON v.knowledge_item_id = items.id
    WHERE items.shop_id = ${input.shopId}
      AND items.retired = false
      AND items.type = 'theory_of_operation'
      AND items.system_codes && ${systems}
      AND ${v.make}
      AND ${v.model}
      AND ${v.engine}
      AND ${v.year}
    ORDER BY items.fire_count DESC, items.updated_at DESC
    LIMIT ${limit}
  `)
  return rows<Row>(res).map(toMatched)
}

export type GetWiringPathInput = {
  shopId: string
  fromComponent: string
  toComponent: string
  vehicle: RetrievalVehicle
  limit?: number
}

// JSON connection arrays are filtered in TypeScript after the SQL pull so
// PGlite + Postgres behave identically. We pull up to 50 candidate wiring
// diagrams for the vehicle, then filter by connection-list contents.
export async function getWiringPath(
  db: RetrievalDb,
  input: GetWiringPathInput,
): Promise<MatchedKnowledgeItem[]> {
  const limit = input.limit ?? 3
  const v = vehicleScopeFragment(input.vehicle)
  const res = await db.execute(sql`
    SELECT items.id, items.shop_id, items.type, items.title, items.body,
      items.structured_data, items.dtc_list, items.system_codes, items.symptoms,
      items.fire_count, 0::int AS score
    FROM knowledge_items items
    JOIN knowledge_item_vehicles v ON v.knowledge_item_id = items.id
    WHERE items.shop_id = ${input.shopId}
      AND items.retired = false
      AND items.type = 'wiring_diagram'
      AND ${v.make}
      AND ${v.model}
      AND ${v.engine}
      AND ${v.year}
    ORDER BY items.fire_count DESC, items.updated_at DESC
    LIMIT 50
  `)
  const filtered = rows<Row>(res)
    .map(toMatched)
    .filter((m) => {
      const conns = (
        m.structuredData as
          | { connections?: Array<{ from_component?: string; to_component?: string }> }
          | null
      )?.connections
      if (!Array.isArray(conns)) return false
      return conns.some(
        (c) =>
          (c.from_component === input.fromComponent && c.to_component === input.toComponent) ||
          (c.from_component === input.toComponent && c.to_component === input.fromComponent),
      )
    })
  return filtered.slice(0, limit)
}

export type GetComponentLocationInput = {
  shopId: string
  componentName: string
  vehicle: RetrievalVehicle
  limit?: number
}

export async function getComponentLocation(
  db: RetrievalDb,
  input: GetComponentLocationInput,
): Promise<MatchedKnowledgeItem[]> {
  const limit = input.limit ?? 3
  const v = vehicleScopeFragment(input.vehicle)
  const res = await db.execute(sql`
    SELECT items.id, items.shop_id, items.type, items.title, items.body,
      items.structured_data, items.dtc_list, items.system_codes, items.symptoms,
      items.fire_count, 0::int AS score
    FROM knowledge_items items
    JOIN knowledge_item_vehicles v ON v.knowledge_item_id = items.id
    WHERE items.shop_id = ${input.shopId}
      AND items.retired = false
      AND items.type = 'connector'
      AND items.structured_data->>'component_name' = ${input.componentName}
      AND ${v.make}
      AND ${v.model}
      AND ${v.engine}
      AND ${v.year}
    ORDER BY items.fire_count DESC, items.updated_at DESC
    LIMIT ${limit}
  `)
  return rows<Row>(res).map(toMatched)
}

export type GetSpecInput = {
  shopId: string
  specName: string
  vehicle: RetrievalVehicle
  limit?: number
}

// Background increment of fire_count per consulted item. Duplicate ids in
// the input increment that row N times. Caller invokes fire-and-forget to
// keep retrieval off the critical path.
export async function incrementFireCount(
  db: RetrievalDb,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return
  const counts = new Map<string, number>()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  for (const [id, n] of counts) {
    await db.execute(sql`
      UPDATE knowledge_items SET fire_count = fire_count + ${n}
      WHERE id = ${id}
    `)
  }
}

// v1 keyword scan; spec calls out a dedicated `spec` type as v2 work.
export async function getSpec(
  db: RetrievalDb,
  input: GetSpecInput,
): Promise<MatchedKnowledgeItem[]> {
  const limit = input.limit ?? 3
  const v = vehicleScopeFragment(input.vehicle)
  const pattern = `%${input.specName.replace(/[%_\\]/g, (m) => `\\${m}`)}%`
  const res = await db.execute(sql`
    SELECT items.id, items.shop_id, items.type, items.title, items.body,
      items.structured_data, items.dtc_list, items.system_codes, items.symptoms,
      items.fire_count, 0::int AS score
    FROM knowledge_items items
    JOIN knowledge_item_vehicles v ON v.knowledge_item_id = items.id
    WHERE items.shop_id = ${input.shopId}
      AND items.retired = false
      AND (
        items.title ILIKE ${pattern}
        OR items.body ILIKE ${pattern}
        OR items.structured_data::text ILIKE ${pattern}
      )
      AND ${v.make}
      AND ${v.model}
      AND ${v.engine}
      AND ${v.year}
    ORDER BY items.fire_count DESC, items.updated_at DESC
    LIMIT ${limit}
  `)
  return rows<Row>(res).map(toMatched)
}
