import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { getOptionalUser } from '@/lib/supabase-server'
import { getProfileByUserId } from '@/lib/db/queries'
import { stripeCustomers } from '@/lib/db/schema'
import { SignUpForm } from './sign-up-form'

/** Existing-user detour for /sign-up:
 *  - Anonymous user → render the form.
 *  - Signed-in with active access (comp or live subscription) → /today.
 *  - Signed-in but no access → /billing (stand-in for /subscribe until PR 5).
 *
 *  Once the paywall middleware (PR 5) lands, this whole detour shrinks to a
 *  single `checkAccess` call. Until then we inline the check here so the
 *  page can't trap a returning customer on the new-signup CTA. */
async function detourSignedInUser(): Promise<string | null> {
  const user = await getOptionalUser()
  if (!user) return null

  const profile = await getProfileByUserId(db, user.id)
  if (!profile) return '/today'
  if (profile.isComp) return '/today'
  if (!profile.shopId) return '/billing'

  const [customer] = await db
    .select()
    .from(stripeCustomers)
    .where(eq(stripeCustomers.shopId, profile.shopId))
    .limit(1)
  const status = customer?.subscriptionStatus
  if (status === 'active' || status === 'trialing') return '/today'
  if (
    status === 'canceled' &&
    customer.currentPeriodEnd &&
    customer.currentPeriodEnd > new Date()
  ) {
    return '/today'
  }
  return '/billing'
}

export default async function SignUpPage() {
  const detour = await detourSignedInUser()
  if (detour) redirect(detour)
  return <SignUpForm />
}
