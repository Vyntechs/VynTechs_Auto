import { and, asc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import { profiles, vendorAccounts } from '@/lib/db/schema'
import { canBuildQuotes, canManageIntegrations } from '@/lib/shop-os/capabilities'

const uuidSchema = z.string().uuid().transform((value) => value.toLowerCase())
const displayNameSchema = z.string().trim().min(1).max(120)
const createBodySchema = z.strictObject({ displayName: displayNameSchema })
const updateBodySchema = z.strictObject({
  displayName: displayNameSchema,
  enabled: z.boolean(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).transform((value) => new Date(value).toISOString()),
})
const scopeSchema = z.enum(['enabled', 'all'])

export type VendorAccountActor = { profileId: string; founderOverride?: boolean }
export type SafeVendorAccount = {
  id: string
  displayName: string
  mode: 'manual'
  enabled: boolean
  updatedAt: string
}
type Failure = {
  ok: false
  error: 'invalid_input' | 'not_found' | 'conflict'
  retryable?: boolean
}
type ListResult = { ok: true; vendorAccounts: SafeVendorAccount[] } | Failure
type MutationResult = { ok: true; changed: boolean; vendorAccount: SafeVendorAccount } | Failure

export function vendorAccountActorFromProfile(
  profile: { id: string },
  founderOverride = false,
): VendorAccountActor {
  return founderOverride
    ? { profileId: profile.id, founderOverride: true }
    : { profileId: profile.id }
}

function invalidInput(): Failure {
  return { ok: false, error: 'invalid_input' }
}

function notFound(): Failure {
  return { ok: false, error: 'not_found' }
}

function conflict(): Failure {
  return { ok: false, error: 'conflict', retryable: false }
}

type ActorRow = { id: string; shopId: string; role: string }

async function loadActor(
  db: AppDb,
  actor: VendorAccountActor,
  mode: 'list' | 'manage',
  lock = false,
): Promise<ActorRow | null> {
  const profileId = uuidSchema.safeParse(actor.profileId)
  if (!profileId.success) return null
  let query = db.select({ id: profiles.id, shopId: profiles.shopId, role: profiles.role })
    .from(profiles)
    .where(and(
      eq(profiles.id, profileId.data),
      eq(profiles.membershipStatus, 'active'),
      isNull(profiles.deactivatedAt),
    ))
    .limit(1)
  if (lock) query = query.for('update') as typeof query
  const [profile] = await query
  if (!profile?.shopId) return null
  const founderOverride = actor.founderOverride === true
  const allowed = mode === 'list'
    ? canBuildQuotes(profile.role) || founderOverride
    : canManageIntegrations(profile.role, founderOverride)
  return allowed ? { id: profile.id, shopId: profile.shopId, role: profile.role } : null
}

function isEmptyRecord(value: unknown): value is Record<string, never> {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === 0
}

function projectRow(row: typeof vendorAccounts.$inferSelect): SafeVendorAccount | null {
  const id = uuidSchema.safeParse(row.id)
  const displayName = displayNameSchema.safeParse(row.displayName)
  if (
    !id.success
    || !displayName.success
    || displayName.data !== row.displayName
    || row.vendor !== 'manual'
    || row.mode !== 'manual'
    || !isEmptyRecord(row.nonSecretConfig)
    || row.secretRef !== null
    || typeof row.enabled !== 'boolean'
    || !(row.updatedAt instanceof Date)
    || !Number.isFinite(row.updatedAt.getTime())
  ) return null
  return {
    id: id.data,
    displayName: displayName.data,
    mode: 'manual',
    enabled: row.enabled,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function publicVendorAccount(account: SafeVendorAccount): SafeVendorAccount {
  return {
    id: account.id,
    displayName: account.displayName,
    mode: 'manual',
    enabled: account.enabled,
    updatedAt: account.updatedAt,
  }
}

function sameCreateTruth(row: typeof vendorAccounts.$inferSelect, displayName: string): boolean {
  return row.vendor === 'manual'
    && row.displayName === displayName
    && row.mode === 'manual'
    && isEmptyRecord(row.nonSecretConfig)
    && row.secretRef === null
    && row.enabled === true
}

function nextTimestamp(previous: Date): Date {
  return new Date(Math.max(Date.now(), previous.getTime() + 1))
}

export async function listVendorAccounts(
  db: AppDb,
  input: { actor: VendorAccountActor; scope: unknown },
): Promise<ListResult> {
  const scope = scopeSchema.safeParse(input.scope)
  if (!scope.success) return invalidInput()
  return db.transaction(async (tx) => {
    const actor = await loadActor(tx, input.actor, scope.data === 'all' ? 'manage' : 'list')
    if (!actor) return notFound()
    const predicates = [
      eq(vendorAccounts.shopId, actor.shopId),
      eq(vendorAccounts.vendor, 'manual'),
      eq(vendorAccounts.mode, 'manual'),
    ]
    if (scope.data === 'enabled') predicates.push(eq(vendorAccounts.enabled, true))
    const rows = await tx.select().from(vendorAccounts)
      .where(and(...predicates))
      .orderBy(asc(vendorAccounts.displayName), asc(vendorAccounts.id))
    const projected = rows.map(projectRow)
    if (projected.some((row) => row === null)) return conflict()
    return { ok: true, vendorAccounts: projected as SafeVendorAccount[] }
  })
}

export async function createManualVendorAccount(
  db: AppDb,
  input: { actor: VendorAccountActor; clientKey: unknown; body: unknown },
): Promise<MutationResult> {
  const clientKey = uuidSchema.safeParse(input.clientKey)
  const body = createBodySchema.safeParse(input.body)
  if (!clientKey.success || !body.success) return invalidInput()
  return db.transaction(async (tx) => {
    const actor = await loadActor(tx, input.actor, 'manage', true)
    if (!actor) return notFound()

    const [existing] = await tx.select().from(vendorAccounts).where(and(
      eq(vendorAccounts.shopId, actor.shopId),
      eq(vendorAccounts.id, clientKey.data),
    )).limit(1).for('update')
    if (existing) {
      const projected = projectRow(existing)
      if (!projected) return conflict()
      return sameCreateTruth(existing, body.data.displayName)
        ? { ok: true, changed: false, vendorAccount: projected }
        : conflict()
    }

    const [created] = await tx.insert(vendorAccounts).values({
      id: clientKey.data,
      shopId: actor.shopId,
      vendor: 'manual',
      displayName: body.data.displayName,
      mode: 'manual',
      nonSecretConfig: {},
      secretRef: null,
      enabled: true,
    }).onConflictDoNothing({ target: vendorAccounts.id }).returning()
    if (created) {
      const projected = projectRow(created)
      return projected
        ? { ok: true, changed: true, vendorAccount: projected }
        : conflict()
    }

    const [persisted] = await tx.select().from(vendorAccounts).where(and(
      eq(vendorAccounts.shopId, actor.shopId),
      eq(vendorAccounts.id, clientKey.data),
    )).limit(1).for('update')
    if (!persisted) return conflict()
    const projected = projectRow(persisted)
    if (!projected) return conflict()
    return sameCreateTruth(persisted, body.data.displayName)
      ? { ok: true, changed: false, vendorAccount: projected }
      : conflict()
  })
}

export async function updateManualVendorAccount(
  db: AppDb,
  input: { actor: VendorAccountActor; vendorAccountId: unknown; body: unknown },
): Promise<MutationResult> {
  const vendorAccountId = uuidSchema.safeParse(input.vendorAccountId)
  const body = updateBodySchema.safeParse(input.body)
  if (!vendorAccountId.success || !body.success) return invalidInput()
  return db.transaction(async (tx) => {
    const actor = await loadActor(tx, input.actor, 'manage', true)
    if (!actor) return notFound()
    const [existing] = await tx.select().from(vendorAccounts).where(and(
      eq(vendorAccounts.shopId, actor.shopId),
      eq(vendorAccounts.id, vendorAccountId.data),
      eq(vendorAccounts.vendor, 'manual'),
      eq(vendorAccounts.mode, 'manual'),
    )).limit(1).for('update')
    if (!existing) return notFound()
    const projected = projectRow(existing)
    if (!projected) return conflict()

    const matchesRequested = existing.displayName === body.data.displayName
      && existing.enabled === body.data.enabled
    if (matchesRequested) return { ok: true, changed: false, vendorAccount: projected }
    if (existing.updatedAt.toISOString() !== body.data.expectedUpdatedAt) return conflict()

    const [updated] = await tx.update(vendorAccounts).set({
      displayName: body.data.displayName,
      enabled: body.data.enabled,
      updatedAt: nextTimestamp(existing.updatedAt),
    }).where(and(
      eq(vendorAccounts.shopId, actor.shopId),
      eq(vendorAccounts.id, vendorAccountId.data),
      eq(vendorAccounts.updatedAt, existing.updatedAt),
    )).returning()
    if (!updated) return conflict()
    const next = projectRow(updated)
    return next ? { ok: true, changed: true, vendorAccount: next } : conflict()
  })
}

export function vendorAccountDomainStatus(result: Failure): number {
  if (result.error === 'invalid_input') return 422
  if (result.error === 'not_found') return 404
  return 409
}

export function vendorAccountErrorBody(result: Failure): { error: Failure['error']; retryable?: boolean } {
  return result.retryable ? { error: result.error, retryable: true } : { error: result.error }
}
