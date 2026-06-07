import type { PartTier } from '@/components/diagram-kit/part-api'
import type { SlotName } from '@/lib/diagnostics/diagram/slot-interface'

/** Absolute position of a slot on the fixed virtual canvas (proto world space: 1320 x 760). */
export type SlotPlacement = {
  x: number
  y: number
  /** which point of the box sits on (x,y) */
  anchor: 'center' | 'top' | 'bottom' | 'left' | 'right'
  /** recede tier — drives opacity/de-emphasis via templates.css, never display:none */
  tier: PartTier
}

/** A template's ordered named slots and where each sits. The KEYS are the only slots the
 *  shape can ever place — the structural leak-lock (no electrical key => no terminal possible). */
export type SlotSet = Partial<Record<SlotName, SlotPlacement>>

/** Camera/framing HINT for the assembler's settleCamera port. T4 declares WHICH slots bound the
 *  frame; it does NOT compute zoom/pan (that is the screen). */
export type FramingHint = {
  /** slots whose bbox the camera frames; empty => frame all placed slots */
  frameSlots: SlotName[]
  /** upper bound on scale, mirroring the proto's per-shape cap (confirm zooms out further) */
  maxScale: number
}

/** The fixed virtual canvas dimensions every template places against. */
export const CANVAS = { width: 1320, height: 760 } as const

/** The active-region ceiling: the lit slot must sit within the top fraction so the mobile
 *  bottom-sheet never covers it (T5 owns the sheet; T4 keeps focus high by construction). */
export const ACTIVE_REGION_BOTTOM = 0.58
