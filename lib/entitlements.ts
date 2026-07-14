import { eq } from 'drizzle-orm'
import type { AppDb } from './db/queries'
import { shopEntitlements } from './db/schema'

// Policy default for a paid shop with NO shop_entitlements row. Pricing for
// the diagnostics add-on does not exist yet, so the default stays true and
// the whole seam is policy-inert: nothing changes for any existing customer.
// When the add-on gets a price, flipping this single constant to false makes
// diagnostics opt-in for shops without an explicit entitlement row.
export const DIAGNOSTICS_DEFAULT_UNTIL_PRICED = true

export type ShopEntitlements = {
  diagnostics: boolean
}

type EntitlementRow = Pick<typeof shopEntitlements.$inferSelect, 'diagnostics'>

// The one place entitlement policy is decided. Order matters:
// comp implies every entitlement; an explicit row is authoritative;
// a missing row falls back to the policy-inert default above.
function resolveDiagnostics(
  row: EntitlementRow | undefined,
  opts: { isComp?: boolean },
): boolean {
  if (opts.isComp) return true
  if (!row) return DIAGNOSTICS_DEFAULT_UNTIL_PRICED
  return row.diagnostics
}

// True when the error (or any nested cause) is Postgres 42P01
// undefined_table. Exists only for the deploy-before-migration window: if
// this code reaches production before migration 0036 is applied, checkAccess
// runs on every request and a hard failure here would be a full outage
// (tasks/lessons.md: production-schema-before-deploy). Missing table resolves
// exactly like a missing row. Safe to remove once 0036 is live.
function isUndefinedTable(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === 'object' && 'code' in current && current.code === '42P01') return true
    current = typeof current === 'object' && 'cause' in current ? current.cause : null
  }
  return false
}

export async function resolveShopEntitlements(
  db: AppDb,
  opts: { shopId: string | null; isComp?: boolean },
): Promise<ShopEntitlements> {
  if (opts.isComp) return { diagnostics: true }
  // Fail closed: a shopless (non-comp) profile has no entitlements. In
  // practice checkAccess paywalls it before entitlements are consulted.
  if (!opts.shopId) return { diagnostics: false }
  let row: EntitlementRow | undefined
  try {
    ;[row] = await db
      .select({ diagnostics: shopEntitlements.diagnostics })
      .from(shopEntitlements)
      .where(eq(shopEntitlements.shopId, opts.shopId))
      .limit(1)
  } catch (error) {
    if (!isUndefinedTable(error)) throw error
    row = undefined
  }
  return { diagnostics: resolveDiagnostics(row, opts) }
}

export async function hasDiagnostics(
  db: AppDb,
  opts: { shopId: string | null; isComp?: boolean },
): Promise<boolean> {
  return (await resolveShopEntitlements(db, opts)).diagnostics
}
