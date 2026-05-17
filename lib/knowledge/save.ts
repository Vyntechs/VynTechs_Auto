import { z } from 'zod'
import { db } from '@/lib/db/client'
import {
  knowledgeItems,
  knowledgeItemVehicles,
  type NewKnowledgeItem,
  type NewKnowledgeItemVehicle,
} from '@/lib/db/schema'
import { normalizeDtc, normalizeEngine } from '@/lib/knowledge/normalize'

// Vehicle scope sub-schema: shared across every type. yearEnd must be >= yearStart
// (the DB CHECK constraint will reject otherwise; we validate here so the
// rejection happens before the transaction starts).
const VehicleScopeSchema = z
  .object({
    yearStart: z.number().int().min(1980).max(2100),
    yearEnd: z.number().int().min(1980).max(2100),
    make: z.string().min(1).max(60),
    model: z.string().min(1).max(60).optional(),
    engine: z.string().min(1).max(60).optional(),
    trim: z.string().min(1).max(60).optional(),
    drivetrain: z.string().min(1).max(60).optional(),
    buildDateAfter: z.string().datetime().optional(),
    buildDateBefore: z.string().datetime().optional(),
    extraQualifiers: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => v.yearEnd >= v.yearStart, {
    message: 'yearEnd must be greater than or equal to yearStart',
  })

// Common tag fields apply to every simple type.
const CommonFields = {
  title: z.string().min(1).max(200),
  dtcList: z.array(z.string()).max(40).optional(),
  systemCodes: z.array(z.string()).max(20).optional(),
  symptoms: z.array(z.string()).max(20).optional(),
  vehicleScopes: z.array(VehicleScopeSchema).max(20).optional(),
  relatedItemIds: z.array(z.string().uuid()).max(40).optional(),
} as const

// Per-type discriminator. Rich types (pinout, connector, wiring_diagram,
// theory_of_operation) are PR 3's scope; this PR rejects them with a clear
// "not yet supported" message so the API contract is explicit.
const CauseFixSchema = z.object({
  type: z.literal('cause_fix'),
  ...CommonFields,
  body: z.string().max(20_000).optional(),
  structuredData: z.object({
    complaint: z.string().min(1).max(2_000).optional(),
    cause: z.string().min(1).max(2_000),
    correction: z.string().min(1).max(2_000),
    first_check: z.string().min(1).max(2_000).optional(),
    dtcs_common: z.array(z.string()).max(40).optional(),
  }),
})

const BulletinSchema = z.object({
  type: z.literal('bulletin'),
  ...CommonFields,
  body: z.string().max(20_000).optional(),
  structuredData: z.object({
    source: z.string().min(1).max(60),
    bulletin_id: z.string().min(1).max(60),
    summary: z.string().max(2_000).optional(),
    body: z.string().max(20_000).optional(),
    link: z.string().url().optional(),
  }),
})

const ReferenceDocSchema = z.object({
  type: z.literal('reference_doc'),
  ...CommonFields,
  body: z.string().min(1).max(20_000),
  structuredData: z.object({}).optional(),
})

const NoteSchema = z.object({
  type: z.literal('note'),
  ...CommonFields,
  body: z.string().min(1).max(20_000),
  structuredData: z.object({}).optional(),
})

export const SAVE_SIMPLE_TYPES = ['cause_fix', 'reference_doc', 'bulletin', 'note'] as const
export const RICH_TYPES_NOT_YET_SUPPORTED = [
  'pinout',
  'connector',
  'wiring_diagram',
  'theory_of_operation',
] as const

export const SimpleSaveSchema = z.discriminatedUnion('type', [
  CauseFixSchema,
  BulletinSchema,
  ReferenceDocSchema,
  NoteSchema,
])

export type SimpleSaveInput = z.infer<typeof SimpleSaveSchema>

type SaveContext = {
  shopId: string
  createdByUserId: string
}

export type SaveResult = { id: string }

export async function saveKnowledgeItem(
  input: SimpleSaveInput,
  ctx: SaveContext,
): Promise<SaveResult> {
  const normalizedDtcs = Array.from(
    new Set(
      (input.dtcList ?? [])
        .map((d) => normalizeDtc(d))
        .filter((d): d is string => d !== null),
    ),
  )

  const itemRow: NewKnowledgeItem = {
    shopId: ctx.shopId,
    type: input.type,
    title: input.title.trim(),
    body: 'body' in input && typeof input.body === 'string' ? input.body : null,
    structuredData:
      'structuredData' in input && input.structuredData
        ? (input.structuredData as Record<string, unknown>)
        : null,
    dtcList: normalizedDtcs,
    systemCodes: input.systemCodes ?? [],
    symptoms: input.symptoms ?? [],
    relatedItemIds: input.relatedItemIds ?? null,
    createdByUserId: ctx.createdByUserId,
  }

  return db.transaction(async (tx) => {
    const [item] = await tx.insert(knowledgeItems).values(itemRow).returning({ id: knowledgeItems.id })
    if (input.vehicleScopes && input.vehicleScopes.length > 0) {
      const scopeRows: NewKnowledgeItemVehicle[] = input.vehicleScopes.map((s) => ({
        knowledgeItemId: item.id,
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
      await tx.insert(knowledgeItemVehicles).values(scopeRows)
    }
    return { id: item.id }
  })
}
