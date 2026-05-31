import type { Flow } from '@/lib/flows/types'
import { isKnownPlatformSlug, isKnownSymptomSlug } from './slug-catalog'

type Result = { ok: true } | { ok: false; errors: string[] }

export function validateFlowForPublish(body: Flow): Result {
  const errors: string[] = []
  const stepIds = new Set(Object.keys(body.steps))

  if (!stepIds.has(body.startStepId)) {
    errors.push(`startStepId "${body.startStepId}" not found in steps`)
  }

  const reachable = collectReachable(body)
  for (const id of stepIds) {
    if (!reachable.has(id)) {
      errors.push(`step "${id}" is unreachable from startStepId`)
    }
  }

  for (const [stepId, step] of Object.entries(body.steps)) {
    if (step.kind === 'question') {
      if (step.answers.length === 0) {
        errors.push(`question step "${stepId}" has zero answers`)
      }
      for (const a of step.answers) {
        // Answer is a compile-time union (next XOR finding), but `body` is a raw
        // `as Flow` cast off JSONB — re-enforce the invariant at runtime so a
        // "stuck" answer (empty next, no finding) or an incomplete FINDING can
        // never publish. next:'' is the single-step "+ Answer" default.
        const next = 'next' in a ? a.next : undefined
        const finding = 'finding' in a ? a.finding : undefined
        const hasNext = typeof next === 'string' && next.trim().length > 0
        if (typeof next === 'string' && next.trim().length > 0 && !stepIds.has(next)) {
          errors.push(`answer "${a.id}" in step "${stepId}" points to non-existent step "${next}"`)
        }
        if (!hasNext && !finding) {
          errors.push(`answer "${a.id}" in step "${stepId}" leads nowhere — give it a next step or a FINDING`)
        }
        if (finding && (finding.verdict.trim().length === 0 || finding.action.trim().length === 0)) {
          errors.push(`answer "${a.id}" in step "${stepId}" has a FINDING missing its verdict or action`)
        }
      }
    } else if (step.kind === 'procedure') {
      if (!stepIds.has(step.next)) {
        errors.push(`procedure step "${stepId}" advances to non-existent step "${step.next}"`)
      }
    }

    const cites = step.citations ?? []
    for (const c of cites) {
      // Citation.excerpt rule: excerpt is required non-empty UNLESS
      // evidenceGrade === 'unverified', in which case it may be empty.
      if (c.evidenceGrade !== 'unverified' && c.excerpt.trim().length === 0) {
        errors.push(`step "${stepId}": citation for ${c.sourceUrl} requires non-empty excerpt (grade=${c.evidenceGrade})`)
      }
    }

    // Unresolved source conflicts block publish — the curator must settle each
    // disagreement (keep a side, or keep both with a condition note) first.
    if ((step.conflicts ?? []).length > 0) {
      errors.push(`step "${stepId}" has an unresolved source conflict — settle it before publishing`)
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

/**
 * Publish-time referential integrity. Replaces the DB FK to platforms/symptoms
 * that the slug decision removed: a flow cannot be published against a slug that
 * is not in the known catalog. Called by publishDraft alongside the body check.
 */
export function validateFlowSlugs(platformSlug: string, symptomSlug: string): Result {
  const errors: string[] = []
  if (!isKnownPlatformSlug(platformSlug)) {
    errors.push(`unknown platform slug "${platformSlug}" — not in the platform catalog`)
  }
  if (!isKnownSymptomSlug(symptomSlug)) {
    errors.push(`unknown symptom slug "${symptomSlug}" — not in the symptom catalog`)
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

function collectReachable(body: Flow): Set<string> {
  const seen = new Set<string>()
  const stack: string[] = [body.startStepId]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    const step = body.steps[id]
    if (!step) continue
    if (step.kind === 'question') {
      for (const a of step.answers) {
        if ('next' in a && a.next) stack.push(a.next)
      }
    } else if (step.kind === 'procedure') {
      stack.push(step.next)
    }
  }
  return seen
}
