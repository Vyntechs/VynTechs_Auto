import type { Flow } from '@/lib/flows/types'

// Plain-English, title-based publish issues for the curator UI. The server's
// validateFlowForPublish stays the authority (re-run on publish); this mirrors
// its rules but speaks in step titles and shop language — never raw step IDs or
// engineer strings. Returns [] when the flow is ready to publish.
export function describePublishIssues(body: Flow): string[] {
  const issues: string[] = []
  const ids = Object.keys(body.steps)
  const stepIds = new Set(ids)

  // Reading-order numbers for any step that has no title yet.
  const ordered = [...ids].sort((a, b) =>
    a === body.startStepId ? -1 : b === body.startStepId ? 1 : 0,
  )
  const numById = new Map(ordered.map((id, i) => [id, i + 1] as const))
  const name = (id: string) => {
    const t = body.steps[id]?.title?.trim()
    return t ? `“${t}”` : `step ${numById.get(id) ?? '?'}`
  }

  if (!stepIds.has(body.startStepId)) {
    issues.push('The flow has no valid starting step.')
  }

  const reachable = collectReachable(body)
  for (const id of ids) {
    if (!reachable.has(id)) issues.push(`${name(id)} can’t be reached — no answer leads to it.`)
  }

  for (const [id, step] of Object.entries(body.steps)) {
    if (step.kind === 'question') {
      if (step.answers.length === 0) {
        issues.push(`${name(id)} is a question with no answers yet.`)
      }
      for (const a of step.answers) {
        const next = 'next' in a ? a.next : undefined
        const finding = 'finding' in a ? a.finding : undefined
        const hasNext = typeof next === 'string' && next.trim().length > 0
        const label = a.label?.trim() ? `“${a.label.trim()}”` : 'an answer'
        if (hasNext && !stepIds.has(next!)) {
          issues.push(`On ${name(id)}, ${label} points to a step that no longer exists.`)
        }
        if (!hasNext && !finding) {
          issues.push(`On ${name(id)}, ${label} doesn’t go anywhere — send it to a step or end the diagnosis.`)
        }
        if (finding && (finding.verdict.trim().length === 0 || finding.action.trim().length === 0)) {
          issues.push(`On ${name(id)}, ${label} ends the diagnosis but is missing what’s wrong or what to do.`)
        }
      }
    } else if (step.kind === 'procedure') {
      if (!stepIds.has(step.next)) {
        issues.push(`${name(id)} doesn’t say which step comes next.`)
      }
    }

    for (const c of step.citations ?? []) {
      if (c.evidenceGrade !== 'unverified' && c.excerpt.trim().length === 0) {
        issues.push(`${name(id)} has a source with no quote — add the line that backs it up, or mark it unverified.`)
      }
    }

    if ((step.conflicts ?? []).length > 0) {
      issues.push(`Settle the source disagreement on ${name(id)} before publishing.`)
    }
  }

  return issues
}

function collectReachable(body: Flow): Set<string> {
  const seen = new Set<string>()
  const stack = [body.startStepId]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    const step = body.steps[id]
    if (!step) continue
    if (step.kind === 'question') {
      for (const a of step.answers) if ('next' in a && a.next) stack.push(a.next)
    } else if (step.kind === 'procedure') {
      stack.push(step.next)
    }
  }
  return seen
}
