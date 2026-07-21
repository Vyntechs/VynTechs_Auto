import { z } from 'zod'

const DRAFT_VERSION = 1
const MAX_DRAFT_BYTES = 8_192
const uuid = z.uuid().transform((value) => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true })

const draftScope = z.strictObject({
  actorProfileId: uuid,
  ticketId: uuid,
  jobId: uuid,
  workspaceUpdatedAt: timestamp,
  workStatus: z.enum(['open', 'in_progress', 'done']),
  authorization: z.enum(['approved', 'declined', 'awaiting_approval']),
})

const draftValues = z.strictObject({
  note: z.string().max(2_000),
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
})

const storedDraft = z.strictObject({
  version: z.literal(DRAFT_VERSION),
  scope: draftScope,
  values: draftValues,
})

export type SimpleWorkDraftScope = z.infer<typeof draftScope>
export type SimpleWorkDraftValues = z.infer<typeof draftValues>

export function simpleWorkDraftStorageKey(
  scope: Pick<SimpleWorkDraftScope, 'actorProfileId' | 'ticketId' | 'jobId'>,
): string {
  return `vyntechs:shop-os:simple-work-draft:v${DRAFT_VERSION}:${scope.actorProfileId}:${scope.ticketId}:${scope.jobId}`
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
  return new TextEncoder().encode(encoded).byteLength <= MAX_DRAFT_BYTES ? encoded : null
}

export function decodeSimpleWorkDraft(
  raw: unknown,
  currentScope: SimpleWorkDraftScope,
): SimpleWorkDraftValues | null {
  const parsedCurrentScope = draftScope.safeParse(currentScope)
  if (!parsedCurrentScope.success || currentScope.workStatus !== 'in_progress' || currentScope.authorization !== 'approved') {
    return null
  }
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > MAX_DRAFT_BYTES) return null
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = storedDraft.safeParse(decoded)
  if (!parsed.success) return null
  const saved = parsed.data.scope
  const current = parsedCurrentScope.data
  if (saved.actorProfileId !== current.actorProfileId
    || saved.ticketId !== current.ticketId
    || saved.jobId !== current.jobId
    || saved.workspaceUpdatedAt !== current.workspaceUpdatedAt) {
    return null
  }
  return parsed.data.values
}
