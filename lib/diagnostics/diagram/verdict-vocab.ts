import type { ForkVerdict } from '@/lib/diagnostics/diagram/step-sequence'

/**
 * Normalize a raw DB branch_logic.verdict string to the ForkVerdict vocab
 * consumed by resolveFork.
 *
 * Schema-legal DB values → ForkVerdict:
 *   'ok'         → 'pass'
 *   'fail'       → 'fail'
 *   'warn'       → 'neutral'
 *   'impossible' → 'neutral'
 *   anything else / empty → 'neutral'  (honest degrade, never throws)
 *
 * Case-insensitive + trims whitespace so ' OK ' maps to 'pass'.
 */
export function mapDbVerdictToFork(dbVerdict: string): ForkVerdict {
  switch (dbVerdict.trim().toLowerCase()) {
    case 'ok':
      return 'pass'
    case 'fail':
      return 'fail'
    case 'warn':
    case 'impossible':
    default:
      return 'neutral'
  }
}
