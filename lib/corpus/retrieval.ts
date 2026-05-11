import { sql } from 'drizzle-orm'
import { embed } from '@/lib/ai/embeddings'
import type { AppDb } from '@/lib/db/queries'

export type CorpusEntrySource = 'founder' | 'curator' | 'auto_promoted'

export type CorpusMatch = {
  id: string
  rootCause: string
  summary: string
  confidenceScore: number
  successConfirmCount: number
  comebackRecordedCount: number
  /** 1 - cosine_distance, clamped to [0, 1]. Higher = closer. */
  similarityScore: number
  /** Provenance — used by the tree-engine prompt to tag founder entries
   *  as SHOP-OWNER VERIFIED so Claude knows to weight them most. */
  entrySource: CorpusEntrySource
}

export type CorpusRetrievalInput = {
  vehicleYear: number
  vehicleMake: string
  vehicleModel: string
  vehicleEngine?: string
  dtcs?: string[]
  symptomTags?: string[]
  complaintText: string
  limit?: number
}

type Row = {
  id: string
  rootCause: string
  summary: string
  confidenceScore: number
  successConfirmCount: number
  comebackRecordedCount: number
  entrySource: CorpusEntrySource
  distance: number
}

/** Founder-only fast lane. Founder entries are the highest source of truth
 *  for the system, so we guarantee them top slots in the result list when
 *  they match — even if a generic auto-promoted entry is closer in vector
 *  space. Limit kept small so they prepend without dominating the list. */
const FOUNDER_PRIORITY_LIMIT = 2

export async function retrieveCorpus(db: AppDb, input: CorpusRetrievalInput): Promise<CorpusMatch[]> {
  const limit = input.limit ?? 5

  const queryText = [
    input.vehicleYear,
    input.vehicleMake,
    input.vehicleModel,
    input.vehicleEngine ?? '',
    (input.dtcs ?? []).join(' '),
    (input.symptomTags ?? []).join(' '),
    input.complaintText,
  ]
    .filter(Boolean)
    .join(' ')
    .trim()

  const queryVec = await embed(queryText)
  const vecLiteral = `[${queryVec.join(',')}]`

  const dtcArray = input.dtcs ?? []
  const tagArray = input.symptomTags ?? []

  // Run founder-priority query and the general query in parallel. The general
  // query may include founder rows too (it's not filtered by entry_source);
  // we dedupe by id when merging, with founder rows always taking precedence.
  const [founderRows, generalRows] = await Promise.all([
    runQuery(db, vecLiteral, dtcArray, tagArray, input, FOUNDER_PRIORITY_LIMIT, "AND entry_source = 'founder'"),
    runQuery(db, vecLiteral, dtcArray, tagArray, input, limit, ''),
  ])

  const seen = new Set<string>()
  const merged: Row[] = []
  for (const r of [...founderRows, ...generalRows]) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    merged.push(r)
    if (merged.length >= limit) break
  }

  return merged.map((r) => ({
    id: r.id,
    rootCause: r.rootCause,
    summary: r.summary,
    confidenceScore: Number(r.confidenceScore),
    successConfirmCount: Number(r.successConfirmCount),
    comebackRecordedCount: Number(r.comebackRecordedCount),
    similarityScore: Math.max(0, 1 - Number(r.distance)),
    // Older rows without the column return undefined; default to the
    // pre-migration baseline so the type stays narrow.
    entrySource: r.entrySource ?? 'auto_promoted',
  }))
}

async function runQuery(
  db: AppDb,
  vecLiteral: string,
  dtcArray: string[],
  tagArray: string[],
  input: CorpusRetrievalInput,
  limit: number,
  extraWhere: string,
): Promise<Row[]> {
  // Note: extraWhere is a literal string fragment built in this file —
  // never user-controlled. Keeping it as a raw injection is safe and
  // avoids a more complex Drizzle conditional.
  const extra = sql.raw(extraWhere)
  return (await db.execute(sql`
    SELECT
      id,
      root_cause AS "rootCause",
      summary,
      confidence_score AS "confidenceScore",
      success_confirm_count AS "successConfirmCount",
      comeback_recorded_count AS "comebackRecordedCount",
      entry_source AS "entrySource",
      embedding <=> ${vecLiteral}::vector AS distance
    FROM corpus_entries
    WHERE
      is_retired = false
      AND vehicle_make = ${input.vehicleMake}
      AND vehicle_model = ${input.vehicleModel}
      AND ABS(vehicle_year - ${input.vehicleYear}) <= 2
      AND (
        (cardinality(${dtcArray}::text[]) = 0 AND cardinality(${tagArray}::text[]) = 0)
        OR (cardinality(${dtcArray}::text[]) > 0 AND dtcs && ${dtcArray}::text[])
        OR (cardinality(${tagArray}::text[]) > 0 AND symptom_tags && ${tagArray}::text[])
      )
      ${extra}
    ORDER BY embedding <=> ${vecLiteral}::vector
    LIMIT ${limit}
  `)) as unknown as Row[]
}
