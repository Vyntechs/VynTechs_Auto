import { and, eq, isNull } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { profiles } from '@/lib/db/schema'
import { canManageTeam, isShopRole, type ShopRole } from './capabilities'

export type TeamActor = {
  userId: string
  shopId: string | null
  role: string
  membershipStatus: string
  isFounder: boolean
}

export type TeamMutationError =
  | 'forbidden'
  | 'no_shop'
  | 'invalid_email'
  | 'invalid_user_id'
  | 'invalid_role'
  | 'invalid_skill_tier'
  | 'protected_role'
  | 'membership_pending'
  | 'not_found'
  | 'cannot_self'
  | 'last_admin'
  | 'already_user'
  | 'already_in_shop'
  | 'already_in_other_shop'
  | 'invite_failed'

export type TeamMutationResult =
  | { ok: true; noop?: true; invitedEmail?: string }
  | { ok: false; error: TeamMutationError; detail?: string | null }

type InviteResponse = {
  data: { user: { id: string } | null } | null
  error: { message?: string } | null
}

type InviteDependency = (
  email: string,
  redirectTo: string,
) => Promise<InviteResponse>

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function validSkillTier(value: unknown): value is 1 | 2 | 3 | null {
  return value === null || value === 1 || value === 2 || value === 3
}

function actorGate(actor: TeamActor): TeamMutationResult | null {
  if (actor.membershipStatus !== 'active') {
    return { ok: false, error: 'membership_pending' }
  }
  if (!canManageTeam(actor.role, actor.isFounder)) {
    return { ok: false, error: 'forbidden' }
  }
  if (!actor.shopId) return { ok: false, error: 'no_shop' }
  return null
}

export async function inviteTeamMember(
  db: AppDb,
  input: {
    actor: TeamActor
    email: unknown
    role?: unknown
    skillTier?: unknown
    redirectTo: string
  },
  inviteUser: InviteDependency,
): Promise<TeamMutationResult> {
  const denied = actorGate(input.actor)
  if (denied) return denied

  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'invalid_email' }

  const role = input.role === undefined ? 'tech' : input.role
  if (!isShopRole(role)) return { ok: false, error: 'invalid_role' }

  const skillTier = input.skillTier === undefined ? null : input.skillTier
  if (!validSkillTier(skillTier)) {
    return { ok: false, error: 'invalid_skill_tier' }
  }

  const { data, error } = await inviteUser(email, input.redirectTo)
  if (error || !data?.user) {
    const alreadyUser = error?.message?.toLowerCase().includes('already') ?? false
    return {
      ok: false,
      error: alreadyUser ? 'already_user' : 'invite_failed',
      detail: error?.message ?? null,
    }
  }

  const [existing] = await db
    .select({ id: profiles.id, shopId: profiles.shopId })
    .from(profiles)
    .where(eq(profiles.userId, data.user.id))
    .limit(1)
  if (existing) {
    return {
      ok: false,
      error:
        existing.shopId === input.actor.shopId
          ? 'already_in_shop'
          : 'already_in_other_shop',
    }
  }

  await db.insert(profiles).values({
    userId: data.user.id,
    shopId: input.actor.shopId,
    role,
    skillTier,
    membershipStatus: 'pending',
    membershipActivatedAt: null,
    fullName: null,
    isComp: false,
    deactivatedAt: null,
  })

  return { ok: true, invitedEmail: email }
}

async function lockActiveOwners(
  tx: Parameters<Parameters<AppDb['transaction']>[0]>[0],
  shopId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ id: profiles.id })
    .from(profiles)
    .where(
      and(
        eq(profiles.shopId, shopId),
        eq(profiles.role, 'owner'),
        eq(profiles.membershipStatus, 'active'),
        isNull(profiles.deactivatedAt),
      ),
    )
    .orderBy(profiles.id)
    .for('update')
  return rows.map((row) => row.id)
}

export async function updateTeamMember(
  db: AppDb,
  input: {
    actor: TeamActor
    targetUserId: unknown
    role: unknown
    skillTier?: unknown
  },
): Promise<TeamMutationResult> {
  const denied = actorGate(input.actor)
  if (denied) return denied
  const shopId = input.actor.shopId as string

  const targetUserId =
    typeof input.targetUserId === 'string' ? input.targetUserId.trim() : ''
  if (!targetUserId) return { ok: false, error: 'invalid_user_id' }
  if (!isShopRole(input.role)) return { ok: false, error: 'invalid_role' }
  if (input.skillTier !== undefined && !validSkillTier(input.skillTier)) {
    return { ok: false, error: 'invalid_skill_tier' }
  }

  return db.transaction(async (tx) => {
    const activeOwnerIds = await lockActiveOwners(tx, shopId)
    const [target] = await tx
      .select()
      .from(profiles)
      .where(and(eq(profiles.userId, targetUserId), eq(profiles.shopId, shopId)))
      .limit(1)
    if (!target) {
      const [outsideShop] = await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.userId, targetUserId))
        .limit(1)
      return {
        ok: false,
        error: outsideShop ? 'forbidden' : 'not_found',
      }
    }

    if (target.isCurator || target.role === 'curator') {
      return { ok: false, error: 'protected_role' }
    }

    if (
      target.role === 'owner' &&
      target.membershipStatus === 'active' &&
      !target.deactivatedAt &&
      input.role !== 'owner' &&
      activeOwnerIds.length <= 1
    ) {
      return { ok: false, error: 'last_admin' }
    }

    const nextTier = input.skillTier === undefined ? target.skillTier : input.skillTier
    if (target.role === input.role && target.skillTier === nextTier) {
      return { ok: true, noop: true }
    }

    await tx
      .update(profiles)
      .set({ role: input.role as ShopRole, skillTier: nextTier as 1 | 2 | 3 | null })
      .where(and(eq(profiles.userId, targetUserId), eq(profiles.shopId, shopId)))
    return { ok: true }
  })
}

export async function deactivateTeamMember(
  db: AppDb,
  input: { actor: TeamActor; targetUserId: unknown },
): Promise<TeamMutationResult> {
  const denied = actorGate(input.actor)
  if (denied) return denied
  const shopId = input.actor.shopId as string

  const targetUserId =
    typeof input.targetUserId === 'string' ? input.targetUserId.trim() : ''
  if (!targetUserId) return { ok: false, error: 'invalid_user_id' }
  if (targetUserId === input.actor.userId) {
    return { ok: false, error: 'cannot_self' }
  }

  return db.transaction(async (tx) => {
    const activeOwnerIds = await lockActiveOwners(tx, shopId)
    const [target] = await tx
      .select()
      .from(profiles)
      .where(and(eq(profiles.userId, targetUserId), eq(profiles.shopId, shopId)))
      .limit(1)
    if (!target) {
      const [outsideShop] = await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.userId, targetUserId))
        .limit(1)
      return {
        ok: false,
        error: outsideShop ? 'forbidden' : 'not_found',
      }
    }
    if (target.isCurator || target.role === 'curator') {
      return { ok: false, error: 'protected_role' }
    }
    if (target.deactivatedAt) return { ok: true, noop: true }
    if (
      target.role === 'owner' &&
      target.membershipStatus === 'active' &&
      activeOwnerIds.length <= 1
    ) {
      return { ok: false, error: 'last_admin' }
    }

    await tx
      .update(profiles)
      .set({ deactivatedAt: new Date() })
      .where(and(eq(profiles.userId, targetUserId), eq(profiles.shopId, shopId)))
    return { ok: true }
  })
}

export function teamMutationStatus(result: TeamMutationResult): number {
  if (result.ok) return 200
  if (result.error === 'not_found') return 404
  if (result.error === 'already_user' || result.error.startsWith('already_in_')) return 409
  if (result.error === 'invite_failed') return 502
  if (
    result.error === 'forbidden' ||
    result.error === 'no_shop' ||
    result.error === 'protected_role' ||
    result.error === 'membership_pending'
  ) return 403
  if (result.error === 'cannot_self' || result.error === 'last_admin') return 400
  return 422
}
