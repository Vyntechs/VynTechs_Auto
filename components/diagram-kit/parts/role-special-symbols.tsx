import type { ReactNode } from 'react'
import type { DiagramPartProps, PartRoleSpecial } from '../part-api'

const GLYPHS: Record<PartRoleSpecial, ReactNode> = {
  ground:        <path d="M60 12 v14 M48 26 h24 M52 32 h16 M56 38 h8" className="dk-glyph-stroke" />,
  relay:         <path d="M44 18 h32 v20 h-32 z M44 28 h-8 M76 28 h8" className="dk-glyph-stroke" />,
  fuse:          <path d="M44 28 h6 q10 -10 20 0 q10 10 16 0 h6" className="dk-glyph-stroke" />,
  'power-source':<path d="M52 18 v20 M68 22 v12 M44 28 h8 M68 28 h8" className="dk-glyph-stroke" />,
}

/** Resolved by role/name, not kind. */
export function RoleSpecialSymbol(props: DiagramPartProps) {
  const role = props.roleSpecial as PartRoleSpecial
  return (
    <svg
      viewBox="0 0 120 72"
      className="dk-part"
      data-kind={props.kind}
      data-role-special={role}
      data-tier={props.tier}
      data-active={props.active}
      data-selected={props.selected}
      data-provenance={props.provenance}
      role="img"
      aria-label={`${role} ${props.name}`}
    >
      <rect x="2" y="2" width="116" height="52" rx="8" className="dk-part__body" />
      <g className="dk-part__glyph">{GLYPHS[role]}</g>
      {props.provenance === 'field-verified' && (
        <path d="M8 14 l3 3 l6 -7" className="dk-part__tick" />
      )}
      <text x="60" y="68" textAnchor="middle" className="dk-part__label">{props.name}</text>
    </svg>
  )
}
