import type { DiagramPartProps } from '../part-api'

/**
 * Generic fallback for ANY unseen kind/role. Neutral hexagon glyph + the part
 * name so an unmodeled value reads as "a part we don't have a glyph for yet" —
 * honest degrade, never a blank or a crash.
 */
export function FallbackPart({
  kind, name, tier, active, selected, provenance,
}: DiagramPartProps) {
  return (
    <svg
      viewBox="0 0 120 64"
      className="dk-part dk-part--fallback"
      data-kind={kind}
      data-tier={tier}
      data-active={active}
      data-selected={selected}
      data-provenance={provenance}
      role="img"
      aria-label={`${kind} ${name}`}
    >
      <polygon
        points="14,32 32,8 88,8 106,32 88,56 32,56"
        className="dk-part__body"
      />
      <text x="60" y="38" textAnchor="middle" className="dk-part__label">
        {name}
      </text>
    </svg>
  )
}
