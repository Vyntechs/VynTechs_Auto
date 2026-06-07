import type { Terminal as TerminalT } from '../part-api'

/**
 * Connection point on a part, colored by what it carries. Renders ONLY when
 * terminal.visible (engine-controlled) — terminals are NEVER always-on. The
 * leak-lock: a pressure step sets visible=false and no terminal appears.
 */
export function Terminal({ terminal }: { terminal: TerminalT }) {
  if (!terminal.visible) return null
  return (
    <g
      className="dk-terminal"
      data-role={terminal.role}
      data-edge={terminal.edge}
      data-active={terminal.active}
      data-selected={terminal.selected}
      aria-label={`${terminal.label} terminal`}
    >
      <circle r="4" className="dk-terminal__dot" />
    </g>
  )
}
