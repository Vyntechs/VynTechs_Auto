import type { ReactNode } from 'react'
import type { DiagramPartProps, PartKind } from '../part-api'

/** Shared part chrome: body frame, provenance draw (graphite/tick/amber), label. */
function PartFrame(
  props: DiagramPartProps & { children: ReactNode; roleSpecialAttr?: string },
) {
  const { kind, name, tier, active, selected, provenance, children, roleSpecialAttr } = props
  return (
    <svg
      viewBox="0 0 120 72"
      className="dk-part"
      data-kind={kind}
      data-role-special={roleSpecialAttr}
      data-tier={tier}
      data-active={active}
      data-selected={selected}
      data-provenance={provenance}
      role="img"
      aria-label={`${kind} ${name}`}
    >
      <rect x="2" y="2" width="116" height="52" rx="8" className="dk-part__body" />
      <g className="dk-part__glyph">{children}</g>
      {provenance === 'field-verified' && (
        <path d="M8 14 l3 3 l6 -7" className="dk-part__tick" />
      )}
      <text x="60" y="68" textAnchor="middle" className="dk-part__label">{name}</text>
    </svg>
  )
}

// One recognizable schematic glyph per kind. A map over the FROZEN vocabulary
// (8 values) — vocabulary mapping, NOT per-case branching.
const GLYPHS: Record<PartKind, ReactNode> = {
  pump:       <circle cx="60" cy="28" r="16" className="dk-glyph-stroke" />,
  sensor:     <path d="M44 36 q16 -28 32 0" className="dk-glyph-stroke" />,
  actuator:   <path d="M48 16 v24 M48 28 h24 l-6 -6 M72 28 l-6 6" className="dk-glyph-stroke" />,
  valve:      <path d="M48 16 l24 24 M72 16 l-24 24 Z" className="dk-glyph-stroke" />,
  module:     <rect x="44" y="14" width="32" height="28" rx="3" className="dk-glyph-stroke" />,
  mechanical: <path d="M50 28 h20 M60 18 v20 M52 20 l16 16 M52 36 l16 -16" className="dk-glyph-stroke" />,
  splice:     <path d="M44 28 h32 M60 22 v12" className="dk-glyph-stroke" />,
  connector:  <path d="M48 20 h16 v16 h-16 z M64 28 h12" className="dk-glyph-stroke" />,
}

export function KindSymbol(props: DiagramPartProps) {
  const kind = props.kind as PartKind
  return <PartFrame {...props}>{GLYPHS[kind]}</PartFrame>
}
