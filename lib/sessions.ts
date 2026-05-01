import { z } from 'zod'
import { intakeSchema } from './types'
import {
  createSession,
  getProfileByUserId,
  getSessionById,
  appendSessionEvent,
  updateSessionTreeState,
} from './db/queries'
import type { AppDb } from './db/queries'
import type { TreeState } from './ai/tree-engine'
import type { IntakePayload } from './types'

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

const advanceSchema = z.object({
  observation: z.string().min(1).max(5000),
})

export type AdvanceSessionResult =
  | { ok: true; tree: TreeState }
  | { ok: false; status: 400 | 401 | 404 | 500; error: string }

export async function advanceSession(opts: {
  db: AppDb
  userId: string
  sessionId: string
  body: unknown
  updateTree: (input: {
    intake: IntakePayload
    currentTree: TreeState
    observation: string
  }) => Promise<TreeState>
}): Promise<AdvanceSessionResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }

  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  if (session.status !== 'open') {
    return { ok: false, status: 400, error: 'session is not open' }
  }

  const parsed = advanceSchema.safeParse(opts.body)
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message }
  }

  let nextTree: TreeState
  try {
    nextTree = await opts.updateTree({
      intake: session.intake,
      currentTree: session.treeState,
      observation: parsed.data.observation,
    })
  } catch (err) {
    console.error('tree update failed:', err)
    return { ok: false, status: 500, error: 'tree update failed' }
  }

  await appendSessionEvent(opts.db, {
    sessionId: opts.sessionId,
    nodeId: session.treeState.currentNodeId,
    eventType: 'observation',
    observationText: parsed.data.observation,
    aiResponse: { nextNodeId: nextTree.currentNodeId },
  })
  await updateSessionTreeState(opts.db, opts.sessionId, nextTree)

  return { ok: true, tree: nextTree }
}
