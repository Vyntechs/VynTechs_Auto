import { isFounder } from '@/lib/auth'

// Curator gate. Previously this passed for both `'curator'` and `'owner'`
// roles, but PR 6 introduces Admin (DB role `'owner'`) as a shop-level
// management role distinct from corpus curation. After the tightening,
// Admins do NOT inherit curator access — only role `'curator'` or the
// founder (single hardcoded user via FOUNDER_EMAIL env var) can curate.
//
// Brandon (founder) keeps full access either way: his role is `'curator'`
// AND his email matches FOUNDER_EMAIL. Mac (Admin / role `'owner'`) is
// correctly blocked.
export function canCurate(
  role: string | null | undefined,
  email: string | null | undefined,
): boolean {
  return role === 'curator' || isFounder(email)
}
