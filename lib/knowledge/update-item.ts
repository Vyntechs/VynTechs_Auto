import { and, eq } from 'drizzle-orm'
import {
  knowledgeItems, knowledgeItemVehicles,
  type NewKnowledgeItemVehicle,
} from '@/lib/db/schema'
import type { AppDb } from '@/lib/db/queries'
import { KnowledgeSaveSchema, type KnowledgeSaveInput } from './save'
import { normalizeDtc, normalizeEngine, type NormalizedDtc } from './normalize'

export async function updateKnowledgeItem(
  db: AppDb,
  args: { id: string; shopId: string },
  input: KnowledgeSaveInput,
): Promise<void> {
  KnowledgeSaveSchema.parse(input)

  const normalizedPairs = (input.dtcList ?? [])
    .map(d => normalizeDtc(d))
    .filter((n): n is NormalizedDtc => n !== null)

  const dtcSet = new Set<string>()
  const subCodesByDtc: Record<string, string> = {}

  const inputSubCodes = 'dtcSubCodes' in input ? input.dtcSubCodes : undefined
  for (const [rawKey, val] of Object.entries(inputSubCodes ?? {})) {
    const n = normalizeDtc(rawKey)
    if (n && typeof val === 'string') subCodesByDtc[n.canonical] = val
  }

  for (const p of normalizedPairs) {
    dtcSet.add(p.canonical)
    if (p.subCode !== null && !(p.canonical in subCodesByDtc)) {
      subCodesByDtc[p.canonical] = p.subCode
    }
  }

  for (const key of Object.keys(subCodesByDtc)) {
    if (!dtcSet.has(key)) delete subCodesByDtc[key]
  }

  const normalizedDtcs = Array.from(dtcSet)
  const dtcSubCodes = Object.keys(subCodesByDtc).length > 0 ? subCodesByDtc : null

  await db.transaction(async tx => {
    const result = await tx
      .update(knowledgeItems)
      .set({
        type: input.type,
        title: input.title.trim(),
        body: 'body' in input && typeof input.body === 'string' ? input.body : null,
        structuredData:
          'structuredData' in input && input.structuredData
            ? (input.structuredData as Record<string, unknown>)
            : null,
        dtcList: normalizedDtcs,
        dtcSubCodes,
        systemCodes: input.systemCodes ?? [],
        symptoms: input.symptoms ?? [],
        relatedItemIds: input.relatedItemIds ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(knowledgeItems.id, args.id), eq(knowledgeItems.shopId, args.shopId)))
      .returning()

    if (result.length === 0) {
      throw new Error(`knowledge item not found or not owned by shop: ${args.id}`)
    }

    await tx.delete(knowledgeItemVehicles).where(eq(knowledgeItemVehicles.knowledgeItemId, args.id))
    if (input.vehicleScopes && input.vehicleScopes.length > 0) {
      const rows: NewKnowledgeItemVehicle[] = input.vehicleScopes.map(s => ({
        knowledgeItemId: args.id,
        yearStart: s.yearStart,
        yearEnd: s.yearEnd,
        make: s.make.trim(),
        model: s.model?.trim() ?? null,
        engine: normalizeEngine(s.engine ?? null),
        trim: s.trim?.trim() ?? null,
        drivetrain: s.drivetrain?.trim() ?? null,
        buildDateAfter: s.buildDateAfter ? new Date(s.buildDateAfter) : null,
        buildDateBefore: s.buildDateBefore ? new Date(s.buildDateBefore) : null,
        extraQualifiers: s.extraQualifiers ?? null,
      }))
      await tx.insert(knowledgeItemVehicles).values(rows)
    }
  })
}
