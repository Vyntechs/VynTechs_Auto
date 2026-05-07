import { eq } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { profiles } from '@/lib/db/schema'
import { canCurate } from './can-curate'

export type GuardResult =
  | { kind: 'allow' }
  | { kind: 'redirect'; to: string }

/**
 * Checks whether a user is allowed to access a path.
 * Non-/curator paths always pass through. /curator/* requires a
 * profile with curator access (role='curator' or 'owner');
 * unauthenticated users go to /sign-in.
 */
export async function guardCuratorRoute(
  db: AppDb,
  userId: string | null,
  path: string,
): Promise<GuardResult> {
  if (!path.startsWith('/curator')) return { kind: 'allow' }
  if (!userId) return { kind: 'redirect', to: '/sign-in' }

  const [profile] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1)

  if (!canCurate(profile?.role)) return { kind: 'redirect', to: '/' }
  return { kind: 'allow' }
}
