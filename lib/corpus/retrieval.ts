import { sql } from 'drizzle-orm'
import { embed } from '@/lib/ai/embeddings'
import type { AppDb } from '@/lib/db/queries'

export type CorpusMatch = {
  id: string
  rootCause: string
  summary: string
  confidenceScore: number
  successConfirmCount: number
  comebackRecordedCount: number
  /** 1 - cosine_distance, clamped to [0, 1]. Higher = closer. */
  similarityScore: number
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
  distance: number
}

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

  // Structured prefilter, then vector rank.
  // Prefilter logic: skip when no DTCs or tags provided; otherwise require
  // overlap on at least one provided dimension. Plan template's OR chain
  // had a logic bug — `cardinality(tagArray)=0` short-circuited the entire
  // OR even when DTCs were provided, defeating the prefilter.
  const rows = (await db.execute(sql`
    SELECT
      id,
      root_cause AS "rootCause",
      summary,
      confidence_score AS "confidenceScore",
      success_confirm_count AS "successConfirmCount",
      comeback_recorded_count AS "comebackRecordedCount",
      embedding <=> ${vecLiteral}::extensions.vector AS distance
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
    ORDER BY embedding <=> ${vecLiteral}::extensions.vector
    LIMIT ${limit}
  `)) as unknown as Row[]

  return rows.map((r) => ({
    id: r.id,
    rootCause: r.rootCause,
    summary: r.summary,
    confidenceScore: Number(r.confidenceScore),
    successConfirmCount: Number(r.successConfirmCount),
    comebackRecordedCount: Number(r.comebackRecordedCount),
    similarityScore: Math.max(0, 1 - Number(r.distance)),
  }))
}
