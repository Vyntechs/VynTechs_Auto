import { aftermarketShopOwner } from './aftermarket-shop-owner'
import { oemMasterTech } from './oem-master-tech'
import { independentDieselShop } from './independent-diesel-shop'
import type { ResearchPersonaId } from '@/lib/research/types'

export type Persona = {
  id: ResearchPersonaId
  displayName: string
  systemPrompt: string
}

export const RESEARCH_PERSONAS: Persona[] = [
  aftermarketShopOwner,
  oemMasterTech,
  independentDieselShop,
]

export function getPersona(id: ResearchPersonaId): Persona {
  const p = RESEARCH_PERSONAS.find((persona) => persona.id === id)
  if (!p) throw new Error(`Unknown persona: ${id}`)
  return p
}

// Re-export the shared clause so external consumers keep the pinned contract
// (personas/index exports SHARED_ANTI_FABRICATION_CLAUSE) without the cycle.
export { SHARED_ANTI_FABRICATION_CLAUSE } from './anti-fabrication'
