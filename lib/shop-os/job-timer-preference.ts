import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import { profiles } from '@/lib/db/schema'
import { canManageTeam } from '@/lib/shop-os/capabilities'

export type JobTimerPreferenceActor = {
  profileId: string
  shopId: string | null
  role: string
  membershipStatus: string
  isFounder: boolean
}

export type JobTimerPreferenceResult =
  | { ok: true; preference: { profileId: string; enabled: boolean } }
  | {
      ok: false
      error: 'invalid_input' | 'forbidden' | 'no_shop' | 'not_found' | 'membership_pending'
    }

export function jobTimerPreferenceStatus(result: JobTimerPreferenceResult): number {
  if (result.ok) return 200
  if (result.error === 'invalid_input') return 422
  if (result.error === 'not_found') return 404
  if (result.error === 'no_shop') return 409
  return 403
}

export function isWrenchingSkillTier(value: unknown): value is 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3
}

const profileIdSchema = z.string().uuid()

async function currentActor(db: AppDb, actor: JobTimerPreferenceActor) {
  if (!profileIdSchema.safeParse(actor.profileId).success) {
    return { ok: false as const, error: 'invalid_input' as const }
  }
  const shopId = actor.shopId
  if (!shopId) return { ok: false as const, error: 'no_shop' as const }
  const [saved] = await db.select({
    id: profiles.id,
    shopId: profiles.shopId,
    role: profiles.role,
    skillTier: profiles.skillTier,
    membershipStatus: profiles.membershipStatus,
    deactivatedAt: profiles.deactivatedAt,
    jobTimerEnabled: profiles.jobTimerEnabled,
  }).from(profiles).where(eq(profiles.id, actor.profileId)).limit(1)
  if (!saved || saved.shopId !== shopId || saved.deactivatedAt) {
    return { ok: false as const, error: 'forbidden' as const }
  }
  if (saved.membershipStatus !== 'active') {
    return { ok: false as const, error: 'membership_pending' as const }
  }
  return { ok: true as const, actor: { ...saved, shopId } }
}

async function preferenceTarget(
  db: AppDb,
  input: { actor: JobTimerPreferenceActor; targetProfileId?: string },
) {
  const current = await currentActor(db, input.actor)
  if (!current.ok) return current

  const targetProfileId = input.targetProfileId ?? current.actor.id
  if (!profileIdSchema.safeParse(targetProfileId).success) {
    return { ok: false as const, error: 'invalid_input' as const }
  }
  const self = targetProfileId === current.actor.id
  if (self && !isWrenchingSkillTier(current.actor.skillTier)) {
    return { ok: false as const, error: 'forbidden' as const }
  }
  if (!self && !canManageTeam(current.actor.role, input.actor.isFounder)) {
    return { ok: false as const, error: 'forbidden' as const }
  }
  const currentManagerAuthority = !self
    ? sql`exists (
        select 1
        from profiles as job_timer_actor
        where job_timer_actor.id = ${input.actor.profileId}::uuid
          and job_timer_actor.shop_id = ${current.actor.shopId}::uuid
          and job_timer_actor.membership_status = 'active'
          and job_timer_actor.deactivated_at is null
          and (${input.actor.isFounder}::boolean or job_timer_actor.role = 'owner')
      )`
    : undefined

  const [target] = await db.select({
    id: profiles.id,
    shopId: profiles.shopId,
    skillTier: profiles.skillTier,
    jobTimerEnabled: profiles.jobTimerEnabled,
  }).from(profiles).where(and(
    eq(profiles.id, targetProfileId),
    eq(profiles.shopId, current.actor.shopId),
    eq(profiles.membershipStatus, 'active'),
    isNull(profiles.deactivatedAt),
    currentManagerAuthority,
  )).limit(1)
  if (!target) return { ok: false as const, error: 'not_found' as const }
  if (!isWrenchingSkillTier(target.skillTier)) {
    return { ok: false as const, error: 'forbidden' as const }
  }
  return { ok: true as const, target: { ...target, shopId: current.actor.shopId } }
}

export async function getJobTimerPreference(
  db: AppDb,
  input: { actor: JobTimerPreferenceActor; targetProfileId?: string },
): Promise<JobTimerPreferenceResult> {
  const current = await preferenceTarget(db, input)
  if (!current.ok) return current
  return {
    ok: true,
    preference: { profileId: current.target.id, enabled: current.target.jobTimerEnabled },
  }
}

export async function updateJobTimerPreference(
  db: AppDb,
  input: { actor: JobTimerPreferenceActor; targetProfileId?: string; enabled: boolean },
): Promise<JobTimerPreferenceResult> {
  if (typeof input.enabled !== 'boolean') return { ok: false, error: 'invalid_input' }
  const current = await preferenceTarget(db, input)
  if (!current.ok) return current
  const managesAnother = current.target.id !== input.actor.profileId
  const currentManagerAuthority = managesAnother
    ? sql`exists (
        select 1
        from profiles as job_timer_actor
        where job_timer_actor.id = ${input.actor.profileId}::uuid
          and job_timer_actor.shop_id = ${current.target.shopId}::uuid
          and job_timer_actor.membership_status = 'active'
          and job_timer_actor.deactivated_at is null
          and (${input.actor.isFounder}::boolean or job_timer_actor.role = 'owner')
      )`
    : undefined
  const [saved] = await db.update(profiles)
    .set({ jobTimerEnabled: input.enabled })
    .where(and(
      eq(profiles.id, current.target.id),
      eq(profiles.shopId, current.target.shopId),
      inArray(profiles.skillTier, [1, 2, 3]),
      eq(profiles.membershipStatus, 'active'),
      isNull(profiles.deactivatedAt),
      currentManagerAuthority,
    ))
    .returning()
  if (!saved) return { ok: false, error: 'forbidden' }
  return {
    ok: true,
    preference: { profileId: saved.id, enabled: saved.jobTimerEnabled },
  }
}
