import type { ReactElement } from 'react'
import type { MeterMode } from '@/lib/diagnostics/load-system-topology'
import type { VerdictSignal } from '@/lib/diagnostics/diagram/slot-interface'

/**
 * C2 — the diagram part API. Type contract + the const tuples behind each union
 * (so consumers can iterate/validate the vocabulary at runtime). NO data fetch,
 * NO slot logic, NO layout math, NO @xyflow, NO AI. Every part is a pure function
 * of this vocabulary; an unseen value resolves to the generic fallback.
 */

// The 8 components.kind values (data-frozen vocabulary).
export const PART_KINDS = [
  'pump', 'sensor', 'actuator', 'valve',
  'module', 'mechanical', 'splice', 'connector',
] as const
export type PartKind = (typeof PART_KINDS)[number]

// Role-specials: resolved by role/name, NOT by kind.
export const PART_ROLE_SPECIALS = [
  'ground', 'relay', 'fuse', 'power-source',
] as const
export type PartRoleSpecial = (typeof PART_ROLE_SPECIALS)[number]

// The 6 electricalRole values. Equals NonNullable<TopologyConnection['electricalRole']>.
export const WIRE_ROLES = [
  'signal', '5v-ref', 'low-ref', 'pwm', '12v', 'ground',
] as const
export type WireRole = (typeof WIRE_ROLES)[number]

export const PART_TIERS = ['focus', 'anchor', 'recede'] as const
export type PartTier = (typeof PART_TIERS)[number]

// Provenance is the RESOLVED draw register, not a raw provenance grade.
// drafted = graphite (default) · field-verified = navy tick · needs-field-check = amber.
export const PART_PROVENANCES = [
  'drafted', 'field-verified', 'needs-field-check',
] as const
export type PartProvenance = (typeof PART_PROVENANCES)[number]

/**
 * A connection point on a part, colored by what it carries.
 * `visible` is ENGINE-controlled (set by T3) — terminals are NEVER always-on;
 * this is the leak-lock on the kit side (a pressure step yields visible:false).
 */
export type Terminal = {
  id: string
  role: WireRole
  edge: 'top' | 'right' | 'bottom' | 'left'
  label: string
  visible: boolean
  active: boolean
  selected: boolean
}

/**
 * Thin handoff to the existing Meter. C2 does NOT re-own the gauge.
 * `unit`/`mode` let the real Meter render EXPECT vs NOW; `verdict` re-uses C3's
 * VerdictSignal (the ONE verdict union — never a private 'fail' spelling).
 */
export type PartReading = {
  expect: string | null
  now: string | null
  unit: string | null
  mode: MeterMode | null
  verdict: VerdictSignal
}

/**
 * Props every kit part accepts. `kind` is open (`PartKind | string`) so an
 * unseen kind from data still type-checks and routes to the generic fallback.
 */
export type DiagramPartProps = {
  kind: PartKind | string
  roleSpecial: PartRoleSpecial | null
  name: string
  tier: PartTier
  active: boolean
  selected: boolean
  provenance: PartProvenance
  terminals?: Terminal[]
  reading?: PartReading | null
}

export type PartComponent = (props: DiagramPartProps) => ReactElement

/** The registry is keyed by DATA (kind|roleSpecial), never a switch in consumers. */
export type RegistryKey = PartKind | PartRoleSpecial
