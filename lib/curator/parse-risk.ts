import type { RiskClass } from '@/lib/db/schema'

const VALID_RISKS: RiskClass[] = ['zero', 'low', 'medium', 'high', 'destructive']

/** Validate a URL search-param against the RiskClass enum. */
export function parseRisk(s: string | undefined): RiskClass | undefined {
  return s && (VALID_RISKS as readonly string[]).includes(s) ? (s as RiskClass) : undefined
}
