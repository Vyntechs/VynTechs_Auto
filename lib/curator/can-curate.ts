import { isFounder } from '@/lib/auth'

// Curator gate. Admin (DB role `'owner'`) inherits curator access by
// design: today the curator team is the three people who all worked at
// the same original shop (Brandon as founder, plus the two Admins).
// Any future shop-level Admin will also inherit curator unless we
// switch to an explicit allowlist or an additive `is_curator` flag.
//
// Founder (Brandon) matches via FOUNDER_EMAIL even if the profile row
// is missing or has a non-curator role.
export function canCurate(
  role: string | null | undefined,
  email: string | null | undefined,
): boolean {
  return role === 'curator' || role === 'owner' || isFounder(email)
}
