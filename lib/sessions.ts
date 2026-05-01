import { intakeSchema } from './types'
import { createSession, getProfileByUserId } from './db/queries'
import type { AppDb } from './db/queries'
import type { TreeState } from './ai/tree-engine'

export type CreateSessionResult =
  | { ok: true; id: string }
  | { ok: false; status: 400 | 401 | 500; error: string }

export async function createSessionForUser(opts: {
  db: AppDb
  userId: string
  body: unknown
  treeState: TreeState
}): Promise<CreateSessionResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }
  if (!profile.shopId) return { ok: false, status: 400, error: 'no shop' }
  const parsed = intakeSchema.safeParse(opts.body)
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message }
  }
  const session = await createSession(opts.db, {
    shopId: profile.shopId,
    techId: profile.id,
    intake: parsed.data,
    treeState: opts.treeState,
  })
  return { ok: true, id: session.id }
}
