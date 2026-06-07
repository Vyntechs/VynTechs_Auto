'use client'

import type { ReactNode } from 'react'
import { useReducedMotion } from '../use-reduced-motion'
import { ScopeClipStub } from '../stubs/scope-clip-stub'
import type { OverlayKind } from './overlay-api'

// One bespoke hookup glyph per kind (vocabulary mapping, not per-case branching).
// Spellings are the canonical C3 union (voltage-drop-bracket / pressure-gauge-tee).
const GLYPHS: Record<Exclude<OverlayKind, 'scope-clip'>, ReactNode> = {
  'probe-lead':           <path d="M0 0 L18 18 M18 18 l-6 0 m6 0 l0 -6" className="dk-overlay__stroke" />,
  'voltage-drop-bracket': <path d="M0 0 v6 M0 3 h24 M24 0 v6" className="dk-overlay__stroke" />,
  'amp-clamp':            <circle cx="12" cy="12" r="10" className="dk-overlay__stroke dk-overlay__pulse" />,
  'pressure-gauge-tee':   <path d="M0 12 h24 M12 12 v-12 M6 0 h12" className="dk-overlay__stroke" />,
  'test-point':           <circle cx="6" cy="6" r="5" className="dk-overlay__stroke" />,
}

/** Resolves the hookup by data. Unseen kind → neutral test-point marker. */
export function TestOverlay({ kind }: { kind: OverlayKind }) {
  const reduced = useReducedMotion()
  if (kind === 'scope-clip') return <ScopeClipStub />
  const isKnown = kind in GLYPHS
  const resolvedKind = isKnown ? kind : 'test-point'
  const glyph = GLYPHS[resolvedKind as Exclude<OverlayKind, 'scope-clip'>]
  return (
    <g className="dk-overlay" data-kind={resolvedKind} data-reduced-motion={reduced}>
      {glyph}
    </g>
  )
}
