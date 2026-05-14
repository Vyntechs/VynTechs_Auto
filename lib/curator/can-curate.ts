import { isFounder } from '@/lib/auth'

// Curator (super-admin) gate. Founders identified by FOUNDER_EMAILS get
// access via email match. The role='curator' DB value is kept as an explicit
// grant path for non-founder reviewers — set it manually on a profile row
// when you want to deputize someone without adding them to the env var.
// IMPORTANT: role='owner' is NOT curator. Owner just means shop owner
// (auto-assigned on signup) and grants shop-level permissions like counter
// orders, not super-admin access.
export function canCurate(
  role: string | null | undefined,
  email: string | null | undefined,
): boolean {
  return role === 'curator' || isFounder(email)
}
