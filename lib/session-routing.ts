import type { Session } from './db/schema'

/**
 * Pure routing decision for the session detail page. Extracted from the
 * server component so the branches can be unit-tested without spinning up
 * Next.js or mocking `redirect()`.
 *
 * Order matters:
 *   1. No tree yet → loading screen
 *   2. Gate blocked → decline page
 *   3. Tree done + session still open → outcome capture (the dead-end fix)
 *   4. Otherwise → active session
 */
export type SessionRoute =
  | { kind: 'tree-generating' }
  | { kind: 'redirect'; to: string }
  | { kind: 'active-session' }

export function routeForSession(
  session: Pick<Session, 'id' | 'status' | 'treeState'>,
): SessionRoute {
  if (!session.treeState || session.treeState.nodes.length === 0) {
    return { kind: 'tree-generating' }
  }
  if (
    session.treeState.gateDecision &&
    !session.treeState.gateDecision.allow
  ) {
    return { kind: 'redirect', to: `/sessions/${session.id}/decline` }
  }
  if (session.treeState.done && session.status === 'open') {
    return { kind: 'redirect', to: `/sessions/${session.id}/outcome` }
  }
  return { kind: 'active-session' }
}
