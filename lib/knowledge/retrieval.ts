import { sql, type SQL } from 'drizzle-orm'
import { normalizeDtc, normalizeEngine } from '@/lib/knowledge/normalize'

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

// Drizzle's full DB type bundles a long schema generic; use a structural
// type so PGlite tests can inject without typing gymnastics.
export type RetrievalDb = {
  execute<T = unknown>(query: SQL): Promise<{ rows: T[] } | T[]>
}

function rows<T>(res: { rows: T[] } | T[]): T[] {
  return Array.isArray(res) ? res : res.rows
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

  const res = await db.execute<Row>(sql`
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
  return rows(res).map(toMatched)
}
