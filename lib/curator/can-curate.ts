import { isFounder } from '@/lib/auth'

// Curator gate. Two ways to qualify:
//   1) the founder, matched via FOUNDER_EMAIL — defense in depth that
//      survives a missing profile row or an unset is_curator flag.
//   2) any profile with the explicit is_curator flag set true.
//
// The DB `role` column is intentionally NOT considered. role='owner' is
// auto-assigned to every new self-service signup on its auto-created
// shop, so reading role as a curator signal would (and previously did)
// hand platform-wide curator access to every signup. Promotion to
// is_curator is a manual founder action.
export function canCurate(
  isCurator: boolean | null | undefined,
  email: string | null | undefined,
): boolean {
  return isCurator === true || isFounder(email)
}
