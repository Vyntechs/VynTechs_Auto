import type { WireRole } from '../part-api'

/** A role-colored wire path. Color/style is the --role-* token for the role. */
export function Wire({
  role, d, active,
}: { role: WireRole; d: string; active: boolean }) {
  return <path className="dk-wire" d={d} data-role={role} data-active={active} />
}
