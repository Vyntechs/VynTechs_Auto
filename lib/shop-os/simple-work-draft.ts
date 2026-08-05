import { z } from 'zod'

const DRAFT_VERSION = 2
const LEGACY_DRAFT_VERSION = 1
const MAX_DRAFT_BYTES = 8_192
const uuid = z.uuid().transform((value) => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true })

const draftScope = z.strictObject({
  actorProfileId: uuid,
  ticketId: uuid,
  jobId: uuid,
  workStatus: z.enum(['open', 'in_progress']),
  authorization: z.literal('approved'),
  savedDetailBaseline: z.string().max(2_000),
})

const auxiliaryValues = {
  concern: z.string().max(500),
  tier: z.enum(['', '1', '2', '3']),
  parts: z.strictObject({
    description: z.string().max(200),
    preference: z.string().max(200),
    quantity: z.string().regex(/^(?:[1-9]|[1-9][0-9])$/),
    requestKey: uuid.nullable(),
  }),
  hold: z.strictObject({
    kind: z.enum(['', 'parts', 'customer', 'schedule', 'shop']),
    note: z.string().max(500),
  }),
}

const draftValues = z.strictObject({
  detail: z.string().max(2_000),
  detailOpen: z.boolean(),
  ...auxiliaryValues,
})

const storedDraft = z.strictObject({
  version: z.literal(DRAFT_VERSION),
  scope: draftScope,
  values: draftValues,
})

const legacyScope = z.strictObject({
  actorProfileId: uuid,
  ticketId: uuid,
  jobId: uuid,
  workspaceUpdatedAt: timestamp,
  workStatus: z.enum(['open', 'in_progress', 'done']),
  authorization: z.enum(['approved', 'declined', 'awaiting_approval']),
})

const legacyValues = z.strictObject({
  note: z.string().max(2_000),
  ...auxiliaryValues,
})

const legacyStoredDraft = z.strictObject({
  version: z.literal(LEGACY_DRAFT_VERSION),
  scope: legacyScope,
  values: legacyValues,
})

export type SimpleWorkDraftScope = z.infer<typeof draftScope>
export type SimpleWorkDraftValues = z.infer<typeof draftValues>
export type SimpleWorkDraftDecodeResult =
  | { kind: 'clean' }
  | { kind: 'invalid' }
  | { kind: 'recovered'; source: 'v1' | 'v2'; values: SimpleWorkDraftValues }
  | {
      kind: 'conflict'
      source: 'v2'
      values: SimpleWorkDraftValues
      savedDetailBaseline: string
      currentSavedDetail: string
    }

type DraftIdentity = Pick<SimpleWorkDraftScope, 'actorProfileId' | 'ticketId' | 'jobId'>

export function simpleWorkDraftStorageKey(scope: DraftIdentity): string {
  return `vyntechs:shop-os:simple-work-draft:v${DRAFT_VERSION}:${scope.actorProfileId}:${scope.ticketId}:${scope.jobId}`
}

export function legacySimpleWorkDraftStorageKey(scope: DraftIdentity): string {
  return `vyntechs:shop-os:simple-work-draft:v${LEGACY_DRAFT_VERSION}:${scope.actorProfileId}:${scope.ticketId}:${scope.jobId}`
}

export function encodeSimpleWorkDraft(
  scope: SimpleWorkDraftScope,
  values: SimpleWorkDraftValues,
): string | null {
  const parsedScope = draftScope.safeParse(scope)
  const parsedValues = draftValues.safeParse(values)
  if (!parsedScope.success || !parsedValues.success) return null
  const encoded = JSON.stringify({
    version: DRAFT_VERSION,
    scope: parsedScope.data,
    values: parsedValues.data,
  })
  return byteLength(encoded) <= MAX_DRAFT_BYTES ? encoded : null
}

export function decodeSimpleWorkDraft(
  raw: unknown,
  currentScope: unknown,
  legacyRaw: unknown = null,
): SimpleWorkDraftDecodeResult {
  const parsedCurrentScope = draftScope.safeParse(currentScope)
  if (!parsedCurrentScope.success) return { kind: 'invalid' }

  if (raw === null) {
    if (legacyRaw === null) return { kind: 'clean' }
    const legacy = parseStored(legacyRaw, legacyStoredDraft)
    if (!legacy || !sameIdentity(legacy.scope, parsedCurrentScope.data)
      || legacy.scope.workStatus !== parsedCurrentScope.data.workStatus
      || legacy.scope.authorization !== parsedCurrentScope.data.authorization) {
      return { kind: 'invalid' }
    }
    return {
      kind: 'recovered',
      source: 'v1',
      values: {
        detail: legacy.values.note,
        detailOpen: legacy.values.note.length > 0,
        concern: legacy.values.concern,
        tier: legacy.values.tier,
        parts: legacy.values.parts,
        hold: legacy.values.hold,
      },
    }
  }

  const saved = parseStored(raw, storedDraft)
  if (!saved || !sameIdentity(saved.scope, parsedCurrentScope.data)
    || saved.scope.workStatus !== parsedCurrentScope.data.workStatus
    || saved.scope.authorization !== parsedCurrentScope.data.authorization) {
    return { kind: 'invalid' }
  }
  if (saved.scope.savedDetailBaseline !== parsedCurrentScope.data.savedDetailBaseline) {
    return {
      kind: 'conflict',
      source: 'v2',
      values: saved.values,
      savedDetailBaseline: saved.scope.savedDetailBaseline,
      currentSavedDetail: parsedCurrentScope.data.savedDetailBaseline,
    }
  }
  return { kind: 'recovered', source: 'v2', values: saved.values }
}

function parseStored<T>(raw: unknown, schema: z.ZodType<T>): T | null {
  if (typeof raw !== 'string' || byteLength(raw) > MAX_DRAFT_BYTES) return null
  try {
    const parsed = schema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function sameIdentity(left: DraftIdentity, right: DraftIdentity): boolean {
  return left.actorProfileId === right.actorProfileId
    && left.ticketId === right.ticketId
    && left.jobId === right.jobId
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
