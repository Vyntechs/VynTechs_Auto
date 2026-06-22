import type { ForkResolution } from '@/lib/diagnostics/diagram/step-sequence'

/**
 * The honest progress line shown after a confirmed check: the curator's authored
 * `reasoning` for the branch the verdict matched — i.e. what this result *told us
 * / ruled out*.
 *
 * Design law (the loop): the line must name what the just-completed check ruled
 * out, drawn ONLY from authored text. When no branch matched the verdict
 * (`kind: 'none'`) or the curator never authored the reasoning half, return null
 * so the caller renders NOTHING — suppression over fabrication, always. We never
 * synthesize a "ruled out X" sentence ourselves, and we never fall back to the
 * forward-looking `nextAction` (that is "what to do next", a different surface).
 */
export function formatRuledOut(resolution: ForkResolution): string | null {
  if (resolution.kind === 'none') return null
  const reasoning = resolution.reasoning?.trim()
  return reasoning && reasoning.length > 0 ? reasoning : null
}
