import { z } from 'zod'

import type { CustomerStory, CustomerStoryMeta } from '@/lib/db/schema'

const MAX_STORY_BYTES = 5_000
const MAX_CLAIM_BYTES = 2_000
export const CUSTOMER_STORY_WAIVER =
  'If you choose not to proceed, the diagnosed issue remains unresolved.'
const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength
const zeroWidth = /[\u200B-\u200D\u2060\uFEFF]/gu
const forbiddenControl = /[\p{Cc}\p{Cf}]/u

export function normalizeCustomerStoryReviewText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\r\n?/gu, '\n')
    .replace(zeroWidth, '')
    .trim()
}

function safeVisibleText(value: string, maxBytes: number): boolean {
  const controlsExcluded = value.replace(/[\n\t]/gu, '')
  return value.length > 0
    && /\S/u.test(value)
    && !forbiddenControl.test(controlsExcluded)
    && utf8Bytes(value) <= maxBytes
}

export const customerStoryReviewTextSchema = z.string()
  .transform(normalizeCustomerStoryReviewText)
  .refine((value) => safeVisibleText(value, MAX_STORY_BYTES))

const canonicalText = (maxBytes: number) => z.string().refine((value) => (
  normalizeCustomerStoryReviewText(value) === value && safeVisibleText(value, maxBytes)
))
const canonicalUuid = z.uuid().refine((value) => value === value.toLowerCase())
const canonicalUuidList = z.array(canonicalUuid).max(5).superRefine((values, context) => {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: 'custom', message: 'IDs must be unique' })
  }
})

const evidenceSchema = z.strictObject({
  claim: canonicalText(MAX_CLAIM_BYTES),
  sourceEventIds: canonicalUuidList,
  sourceArtifactIds: canonicalUuidList,
})
const persistedCustomerStorySchema = z.strictObject({
  whatYouToldUs: canonicalText(MAX_STORY_BYTES),
  whatWeFound: canonicalText(MAX_STORY_BYTES),
  howWeKnow: z.array(evidenceSchema).max(5),
  whatItMeansIfWaived: canonicalText(MAX_STORY_BYTES),
  whatWeRecommend: canonicalText(MAX_STORY_BYTES),
})

const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/)
const timestampSchema = z.iso.datetime({ offset: true })
const commonMetaShape = {
  sessionId: canonicalUuid,
  generatedAt: timestampSchema,
  lastEditedByProfileId: canonicalUuid,
  lastEditedAt: timestampSchema,
  generationClientKey: canonicalUuid,
  generationRequestFingerprint: fingerprintSchema,
  generatedByProfileId: canonicalUuid,
  storyRevision: z.number().int().nonnegative(),
}
const reviewAuditShape = {
  reviewClientKey: canonicalUuid,
  reviewRequestFingerprint: fingerprintSchema,
  reviewedByProfileId: canonicalUuid,
  reviewedAt: timestampSchema,
}
const pendingAiMetaSchema = z.strictObject({
  source: z.literal('ai'),
  ...commonMetaShape,
  reviewStatus: z.literal('pending'),
})
const reviewedAiMetaSchema = z.strictObject({
  source: z.literal('ai'),
  ...commonMetaShape,
  reviewStatus: z.literal('reviewed'),
  ...reviewAuditShape,
})
// sessionId is present for the topology-session manual path and absent for
// sessionless manual findings (diagnostics add-on not on the shop — the
// Record-findings path writes the same story shape with no session).
const reviewedManualMetaSchema = z.strictObject({
  source: z.literal('manual'),
  sessionId: canonicalUuid.optional(),
  lastEditedByProfileId: canonicalUuid,
  lastEditedAt: timestampSchema,
  storyRevision: z.number().int().positive(),
  reviewStatus: z.literal('reviewed'),
  ...reviewAuditShape,
})
const templateMetaSchema = z.strictObject({
  source: z.literal('template'),
  sessionId: canonicalText(200).optional(),
  generatedAt: canonicalText(200).optional(),
  lastEditedByProfileId: canonicalUuid,
  lastEditedAt: canonicalText(200),
})
const persistedCustomerStoryMetaSchema = z.union([
  pendingAiMetaSchema,
  reviewedAiMetaSchema,
  reviewedManualMetaSchema,
  templateMetaSchema,
])

const quoteStorySnapshotMetaSchema = z.union([
  z.strictObject({ source: z.literal('ai'), sessionId: canonicalUuid }),
  z.strictObject({ source: z.literal('manual'), sessionId: canonicalUuid.optional() }),
  z.strictObject({ source: z.literal('template'), sessionId: canonicalText(200).optional() }),
])

export type SafeCustomerStoryMeta = Pick<
  CustomerStoryMeta,
  'source' | 'sessionId' | 'generatedAt' | 'lastEditedAt' | 'reviewStatus' | 'storyRevision' | 'reviewedAt'
>

export function parsePersistedCustomerStory(value: unknown): CustomerStory | null {
  const parsed = persistedCustomerStorySchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parsePersistedCustomerStoryMeta(value: unknown): CustomerStoryMeta | null {
  const parsed = persistedCustomerStoryMetaSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseQuoteStorySnapshotMeta(
  value: unknown,
): Pick<CustomerStoryMeta, 'source' | 'sessionId'> | null {
  const parsed = quoteStorySnapshotMetaSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function safeCustomerStoryMeta(meta: CustomerStoryMeta): SafeCustomerStoryMeta {
  return {
    source: meta.source,
    ...(meta.sessionId ? { sessionId: meta.sessionId } : {}),
    ...(meta.generatedAt ? { generatedAt: meta.generatedAt } : {}),
    lastEditedAt: meta.lastEditedAt,
    ...(meta.reviewStatus ? { reviewStatus: meta.reviewStatus } : {}),
    ...(meta.storyRevision !== undefined ? { storyRevision: meta.storyRevision } : {}),
    ...(meta.reviewedAt ? { reviewedAt: meta.reviewedAt } : {}),
  }
}
