import type { KnowledgeItem } from '@/lib/db/schema'

export type KnowledgeType = KnowledgeItem['type']

export const TYPE_LABELS: Record<KnowledgeType, string> = {
  cause_fix: 'Cause + fix',
  reference_doc: 'Reference doc',
  bulletin: 'Bulletin',
  note: 'Note',
  pinout: 'Pinout',
  connector: 'Connector',
  wiring_diagram: 'Wiring diagram',
  theory_of_operation: 'Theory',
}

export const TYPE_SHORT: Record<KnowledgeType, string> = {
  cause_fix: 'CAUSE+FIX',
  reference_doc: 'REFDOC',
  bulletin: 'BULLETIN',
  note: 'NOTE',
  pinout: 'PINOUT',
  connector: 'CONN',
  wiring_diagram: 'WIRING',
  theory_of_operation: 'THEORY',
}

export const SYSTEM_CODES = [
  'transmission', 'engine', 'can_bus', 'fuel_delivery', 'ignition',
  'charging', 'hvac', 'brakes', 'suspension', 'body_electrical',
  'cooling', 'emissions', 'lighting', 'steering', 'abs', 'sas',
  'hybrid_drive', 'restraint', 'infotainment', 'network',
] as const

export type SystemCode = (typeof SYSTEM_CODES)[number]
