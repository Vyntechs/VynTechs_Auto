import {
  PART_KINDS,
  PART_ROLE_SPECIALS,
  type PartComponent,
  type RegistryKey,
} from './part-api'
import { KindSymbol } from './parts/kind-symbols'
import { RoleSpecialSymbol } from './parts/role-special-symbols'
import { FallbackPart } from './parts/fallback-part'

/**
 * (kind|roleSpecial) -> component. Consumers resolve by DATA, never a switch.
 * Each key maps to its bespoke symbol; an unseen key resolves to the generic
 * fallback. Replacing art is a registry edit only — no consumer changes.
 */
const REGISTRY: Record<RegistryKey, PartComponent> = {
  ...Object.fromEntries(PART_KINDS.map((k) => [k, KindSymbol])),
  ...Object.fromEntries(PART_ROLE_SPECIALS.map((r) => [r, RoleSpecialSymbol])),
} as Record<RegistryKey, PartComponent>

const KNOWN = new Set<string>([...PART_KINDS, ...PART_ROLE_SPECIALS])

export function isFallbackKey(key: RegistryKey): boolean {
  return !KNOWN.has(key)
}

/** Always returns a component — the generic fallback for any unseen key. */
export function resolvePart(key: RegistryKey): PartComponent {
  return REGISTRY[key] ?? FallbackPart
}
