import {
  PART_KINDS,
  PART_ROLE_SPECIALS,
  type PartComponent,
  type RegistryKey,
} from './part-api'
import { StubPart } from './stubs/stub-part'
import { FallbackPart } from './parts/fallback-part'

/**
 * (kind|roleSpecial) -> component. Consumers resolve by DATA, never a switch.
 * Wave 0 maps every key to the parametric stub; Wave 1 replaces entries with
 * bespoke art — the registry is the only edit, no consumer changes.
 */
const REGISTRY: Record<RegistryKey, PartComponent> = Object.fromEntries(
  [...PART_KINDS, ...PART_ROLE_SPECIALS].map((k) => [k, StubPart]),
) as Record<RegistryKey, PartComponent>

const KNOWN = new Set<string>([...PART_KINDS, ...PART_ROLE_SPECIALS])

export function isFallbackKey(key: RegistryKey): boolean {
  return !KNOWN.has(key)
}

/** Always returns a component — the generic fallback for any unseen key. */
export function resolvePart(key: RegistryKey): PartComponent {
  return REGISTRY[key] ?? FallbackPart
}
