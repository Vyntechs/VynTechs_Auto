import type { ReactNode } from 'react'
import type { SlotName, SlotFill } from '@/lib/diagnostics/diagram/slot-interface'
import type { DiagramPartProps } from '@/components/diagram-kit/part-api'
import { resolvePart } from '@/components/diagram-kit'
import type { SlotPlacement } from './template-local-types'
// The kit's part/wire/overlay/terminal glyph styling. Without this the SVG parts
// render with NO stroke (invisible) on the screen — it was only loaded by the
// standalone catalog before. Importing it here loads it wherever a template renders.
import '@/components/diagram-kit/diagram-kit.css'

const ANCHOR_TRANSFORM: Record<SlotPlacement['anchor'], string> = {
  center: 'translate(-50%, -50%)',
  top: 'translate(-50%, 0)',
  bottom: 'translate(-50%, -100%)',
  left: 'translate(0, -50%)',
  right: 'translate(-100%, -50%)',
}

export function SlotBox({
  name,
  placement,
  fill,
  onInspect,
  selectedPartId,
}: {
  name: SlotName
  placement: SlotPlacement
  fill: SlotFill
  onInspect?: (partId: string) => void
  selectedPartId?: string | null
}): ReactNode {
  const style = {
    left: `${placement.x}px`,
    top: `${placement.y}px`,
    transform: ANCHOR_TRANSFORM[placement.anchor],
  }
  const common = { className: 'slot-box', style, 'data-slot': name, 'data-tier': placement.tier } as const

  // Honest degrade — never blank, never crash (null fill, or a fill that has no
  // standalone box rendering here, e.g. wire-set).
  if (fill == null) {
    return <div {...common} className="slot-box is-degraded">needs field check</div>
  }
  if (fill.fillKind === 'part') {
    const Part = resolvePart(fill.roleSpecial ?? fill.kind)
    const props: DiagramPartProps = {
      kind: fill.kind,
      roleSpecial: fill.roleSpecial,
      name: fill.name,
      tier: fill.tier,
      active: fill.active,
      selected: fill.selected || selectedPartId === fill.partId,
      provenance: fill.provenance,
      terminals: fill.terminals,
    }
    return (
      <div
        {...common}
        data-inspect-part-id={fill.partId}
        data-selected={props.selected || undefined}
        role="button"
        tabIndex={0}
        onClick={() => onInspect?.(fill.partId)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onInspect?.(fill.partId)
        }}
      >
        <Part {...props} />
      </div>
    )
  }
  if (fill.fillKind === 'detail') {
    // Prose payload (why / probe / secondary / operational theory).
    const lines = [fill.why, fill.probe, fill.secondary, fill.theori].filter(Boolean)
    return (
      <div {...common} className="slot-box slot-box--detail">
        {lines.join(' · ') || <span className="slot-box is-degraded">needs field check</span>}
      </div>
    )
  }
  if (fill.fillKind === 'route') {
    // Degraded words-only fork arm.
    return <div {...common}>{fill.nextActionText ?? 'needs field check'}</div>
  }
  // gauge / overlay / wire-set are placed by their owning region (GaugeRegion /
  // OverlayRegion), not as a standalone SlotBox — degrade defensively if one reaches here.
  return <div {...common} className="slot-box is-degraded">needs field check</div>
}
