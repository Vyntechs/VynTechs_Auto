/**
 * Drizzle's db.execute() returns array-shaped results in postgres-js but
 * { rows: [...] }-shaped results in PGlite (test env). Normalize to a
 * plain array so callers can ignore the difference.
 */
export function unwrapRows<R>(result: unknown): R[] {
  if (Array.isArray(result)) return result as R[]
  if (
    result !== null &&
    typeof result === 'object' &&
    'rows' in result &&
    Array.isArray((result as { rows: unknown }).rows)
  ) {
    return (result as { rows: R[] }).rows
  }
  return []
}
