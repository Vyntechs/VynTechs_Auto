import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { profiles, sessions, ticketJobs } from '@/lib/db/schema'
import type { AppDb } from '@/lib/db/queries'

export type TeamMember = {
  id: string
  name: string
  skillTier: number
  isCurrentUser: boolean
  workload?: { open: number; today: number }
}

export type GetShopTeamInput = {
  db: AppDb
  shopId: string
  currentUserId: string
}

export type GetShopTeamResult = {
  members: TeamMember[]
  workloadFailed: boolean
}

export async function getShopTeam(input: GetShopTeamInput): Promise<GetShopTeamResult> {
  const { db, shopId, currentUserId } = input

  // Roster query — bubble errors (page 500s, see spec Risk section).
  const roster = await db
    .select({
      id: profiles.id,
      fullName: profiles.fullName,
      skillTier: profiles.skillTier,
    })
    .from(profiles)
    .where(
      and(
        eq(profiles.shopId, shopId),
        eq(profiles.membershipStatus, 'active'),
        isNull(profiles.deactivatedAt),
        isNotNull(profiles.skillTier),
      ),
    )

  // Sort: nulls last on fullName, then alpha. Done in JS for portability —
  // Drizzle's NULLS LAST helper isn't consistently available across dialects.
  roster.sort((a, b) => {
    if (a.fullName === null && b.fullName !== null) return 1
    if (a.fullName !== null && b.fullName === null) return -1
    if (a.fullName === null && b.fullName === null) {
      return a.id < b.id ? -1 : 1
    }
    return (a.fullName ?? '').localeCompare(b.fullName ?? '')
  })

  const memberIds = roster.map((r) => r.id)

  // Workload query — best-effort. Any error degrades to badges-hidden.
  let workloadFailed = false
  const workloadByTech = new Map<string, { open: number; today: number }>()
  if (memberIds.length > 0) {
    try {
      const jobRows = await db
        .select({
          techId: ticketJobs.assignedTechId,
          openCount: sql<number>`count(*)::int`,
          todayCount: sql<number>`count(*) filter (where ${ticketJobs.createdAt} >= date_trunc('day', now()))::int`,
        })
        .from(ticketJobs)
        .where(
          and(
            eq(ticketJobs.shopId, shopId),
            eq(ticketJobs.workStatus, 'open'),
            inArray(ticketJobs.assignedTechId, memberIds),
          ),
        )
        .groupBy(ticketJobs.assignedTechId)
      const legacySessionRows = await db
        .select({
          techId: sessions.techId,
          openCount: sql<number>`count(*)::int`,
          todayCount: sql<number>`count(*) filter (where ${sessions.createdAt} >= date_trunc('day', now()))::int`,
        })
        .from(sessions)
        .where(
          and(
            eq(sessions.shopId, shopId),
            eq(sessions.status, 'open'),
            inArray(sessions.techId, memberIds),
            sql`not exists (
              select 1 from ${ticketJobs}
              where ${ticketJobs.sessionId} = ${sessions.id}
            )`,
          ),
        )
        .groupBy(sessions.techId)
      for (const row of [...jobRows, ...legacySessionRows]) {
        if (row.techId) {
          const workload = workloadByTech.get(row.techId) ?? { open: 0, today: 0 }
          workload.open += Number(row.openCount)
          workload.today += Number(row.todayCount)
          workloadByTech.set(row.techId, workload)
        }
      }
    } catch (err) {
      console.error('getShopTeam workload query failed:', err)
      workloadFailed = true
    }
  }

  const members: TeamMember[] = roster.map((row) => {
    const isCurrentUser = row.id === currentUserId
    const name = row.fullName ?? 'Tech'
    const base: TeamMember = {
      id: row.id,
      name,
      skillTier: row.skillTier!,
      isCurrentUser,
    }
    if (!workloadFailed) {
      base.workload = workloadByTech.get(row.id) ?? { open: 0, today: 0 }
    }
    return base
  })

  // Pin the current user to the front of the array.
  const currentIdx = members.findIndex((m) => m.isCurrentUser)
  if (currentIdx > 0) {
    const [current] = members.splice(currentIdx, 1)
    members.unshift(current)
  }

  return { members, workloadFailed }
}
