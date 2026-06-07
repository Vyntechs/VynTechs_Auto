import type { DiagramPartProps } from '../part-api'

/**
 * Typed placeholder so T3/T4/T5 render before bespoke art lands. Draws a labeled
 * rounded rect reflecting tier/active/selected/provenance. Replaced per-kind in
 * Wave 1; the registry swaps the entry, no consumer change.
 */
export function StubPart({
  kind, name, tier, active, selected, provenance,
}: DiagramPartProps) {
  return (
    <svg
      viewBox="0 0 120 64"
      className="dk-part dk-part--stub"
      data-kind={kind}
      data-tier={tier}
      data-active={active}
      data-selected={selected}
      data-provenance={provenance}
      role="img"
      aria-label={`${kind} ${name}`}
    >
      <rect x="2" y="2" width="116" height="60" rx="8" className="dk-part__body" />
      <text x="60" y="36" textAnchor="middle" className="dk-part__label">
        {name}
      </text>
    </svg>
  )
}
