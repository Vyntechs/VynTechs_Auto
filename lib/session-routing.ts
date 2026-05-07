import type { Session } from './db/schema'

/**
 * Pure routing decision for the session detail page. Extracted from the
 * server component so the branches can be unit-tested without spinning up
 * Next.js or mocking `redirect()`.
 *
 * Order matters:
 *   1. Closed session → read-only summary (no more form-loop)
 *   2. No tree yet → loading screen
 *   3. Gate blocked → decline page
 *   4. Otherwise → active-session view (handles in-progress AND
 *      diagnosis-complete states; when treeState.done is true the
 *      active-session view renders the AI's root-cause summary, safety
 *      message, recommended repair, and expected post-repair signal — and
 *      the tech clicks Close case manually after the repair + verification
 *      rather than being auto-redirected mid-render).
 */
export type SessionRoute =
  | { kind: 'tree-generating' }
  | { kind: 'redirect'; to: string }
  | { kind: 'active-session' }
  | { kind: 'closed-summary' }

export function routeForSession(
  session: Pick<Session, 'id' | 'status' | 'treeState'>,
): SessionRoute {
  if (session.status === 'closed') {
    return { kind: 'closed-summary' }
  }
  if (!session.treeState || session.treeState.nodes.length === 0) {
    return { kind: 'tree-generating' }
  }
  if (
    session.treeState.gateDecision &&
    !session.treeState.gateDecision.allow
  ) {
    return { kind: 'redirect', to: `/sessions/${session.id}/decline` }
  }
  return { kind: 'active-session' }
}
