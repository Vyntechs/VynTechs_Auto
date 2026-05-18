import { z } from 'zod'
import { db } from '@/lib/db/client'
import {
  knowledgeItems,
  knowledgeItemVehicles,
  type NewKnowledgeItem,
  type NewKnowledgeItemVehicle,
} from '@/lib/db/schema'
import { normalizeDtc, normalizeEngine, type NormalizedDtc } from '@/lib/knowledge/normalize'

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
  dtcSubCodes: z
    .record(
      z.string().regex(/^[PBCU][0-3][0-9A-F]{3}$/),
      z.string().regex(/^[0-9A-F]{2}$/),
    )
    .optional(),
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

const PinRowSchema = z.object({
  pin_number: z.string().min(1).max(8),
  signal_name: z.string().min(1).max(120),
  wire_color: z.string().max(40).optional(),
  expected_voltage_or_waveform: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
})

const PinoutSchema = z.object({
  type: z.literal('pinout'),
  ...CommonFields,
  body: z.string().max(20_000).optional(),
  structuredData: z.object({
    connector_ref: z.string().min(1).max(120),
    pins: z
      .array(PinRowSchema)
      .min(1)
      .max(120)
      .refine(
        (arr) => new Set(arr.map((p) => p.pin_number)).size === arr.length,
        { message: 'duplicate pin_number values' },
      ),
  }),
})

const ConnectorSchema = z.object({
  type: z.literal('connector'),
  ...CommonFields,
  body: z.string().max(20_000).optional(),
  structuredData: z.object({
    connector_id: z.string().min(1).max(60),
    component_name: z.string().min(1).max(120),
    location_description: z.string().max(2_000).optional(),
    image_ref: z.string().max(500).optional(),
    mating_end_image_ref: z.string().max(500).optional(),
  }),
})

const WiringConnectionSchema = z.object({
  from_component: z.string().min(1).max(120),
  from_pin: z.string().max(20).optional(),
  to_component: z.string().min(1).max(120),
  to_pin: z.string().max(20).optional(),
  wire_color: z.string().max(40).optional(),
  splice_id: z.string().max(60).optional(),
  notes: z.string().max(500).optional(),
})

const WiringDiagramSchema = z.object({
  type: z.literal('wiring_diagram'),
  ...CommonFields,
  body: z.string().max(20_000).optional(),
  structuredData: z.object({
    name: z.string().min(1).max(200),
    image_ref: z.string().min(1).max(500),
    connections: z.array(WiringConnectionSchema).max(200).optional().default([]),
  }),
})

const TheorySectionSchema = z.object({
  heading: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
})

const TheoryOfOperationSchema = z.object({
  type: z.literal('theory_of_operation'),
  ...CommonFields,
  body: z.string().max(20_000).optional(),
  structuredData: z.object({
    title: z.string().min(1).max(200),
    sections: z.array(TheorySectionSchema).min(1).max(40),
  }),
})

export const SAVE_SIMPLE_TYPES = ['cause_fix', 'reference_doc', 'bulletin', 'note'] as const
export const SAVE_RICH_TYPES = ['pinout', 'connector', 'wiring_diagram', 'theory_of_operation'] as const
export const SAVE_ALL_TYPES = [...SAVE_SIMPLE_TYPES, ...SAVE_RICH_TYPES] as const

export const KnowledgeSaveSchema = z.discriminatedUnion('type', [
  CauseFixSchema,
  BulletinSchema,
  ReferenceDocSchema,
  NoteSchema,
  PinoutSchema,
  ConnectorSchema,
  WiringDiagramSchema,
  TheoryOfOperationSchema,
])

export type KnowledgeSaveInput = z.infer<typeof KnowledgeSaveSchema>

type SaveContext = {
  shopId: string
  createdByUserId: string
}

export type SaveResult = { id: string }

export async function saveKnowledgeItem(
  input: KnowledgeSaveInput,
  ctx: SaveContext,
): Promise<SaveResult> {
  const normalizedPairs = (input.dtcList ?? [])
    .map((d) => normalizeDtc(d))
    .filter((n): n is NormalizedDtc => n !== null)

  const dtcSet = new Set<string>()
  const subCodesByDtc: Record<string, string> = {}

  // Sub-codes from the explicit dtcSubCodes input (typed in via the chip).
  // Only keep entries whose key passes normalizeDtc (defense in depth — the
  // zod schema already restricts the shape, but the parallel map could drift).
  const inputSubCodes = 'dtcSubCodes' in input ? input.dtcSubCodes : undefined
  for (const [rawKey, val] of Object.entries(inputSubCodes ?? {})) {
    const n = normalizeDtc(rawKey)
    if (n && typeof val === 'string') subCodesByDtc[n.canonical] = val
  }

  // Sub-codes inferred from dtcList entries that themselves carried a tail
  // (e.g. AI parser emitted "P0420-00" — rare but handled).
  for (const p of normalizedPairs) {
    dtcSet.add(p.canonical)
    if (p.subCode !== null && !(p.canonical in subCodesByDtc)) {
      subCodesByDtc[p.canonical] = p.subCode
    }
  }

  // Drop stale sub-codes: only keep entries for DTCs in the final list.
  for (const key of Object.keys(subCodesByDtc)) {
    if (!dtcSet.has(key)) delete subCodesByDtc[key]
  }

  const normalizedDtcs = Array.from(dtcSet)
  const dtcSubCodes = Object.keys(subCodesByDtc).length > 0 ? subCodesByDtc : null

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
    dtcSubCodes,
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
