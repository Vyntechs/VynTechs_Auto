'use client'

/**
 * The honest progress line: after a confirmed check, this names what the result
 * RULED OUT, in the curator's own authored words (sourced from the matched
 * branch's reasoning via `formatRuledOut`). The parent passes `null` whenever
 * that authored half is missing, and we render NOTHING — suppression over
 * fabrication. No counts, no percent, ever.
 *
 * aria-live=polite so each new elimination is announced: the satisfying "one
 * more thing crossed off" beat the loop is built around.
 */
export function ProgressLine({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <div className="topo-loop__ruled" role="status" aria-live="polite">
      <span className="topo-loop__ruled-mark" aria-hidden="true">✓</span>
      <p className="topo-loop__ruled-text">{text}</p>
    </div>
  )
}
