import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db/client'
import { requireUserAndProfile } from '@/lib/auth'
import { createCheckoutSessionForUser } from '@/lib/stripe'
import { getServerSupabase } from '@/lib/supabase-server'

/** GET variant of the checkout-session creator. Used by the OAuth callback
 *  flow: the user lands here right after Google sign-in, we mint a Stripe
 *  Checkout Session, and 302 the browser straight to Stripe-hosted
 *  checkout. The POST sibling at /api/stripe/checkout handles the email +
 *  password path, which already has fetch() in hand and can take a JSON
 *  response. */
export async function GET(req: NextRequest) {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) {
    return NextResponse.redirect(new URL('/sign-in', req.url))
  }

  const origin = new URL(req.url).origin
  const priceId = process.env.STRIPE_PRICE_ID ?? ''

  const result = await createCheckoutSessionForUser({
    db,
    userId: ctx.user.id,
    email: ctx.user.email,
    origin,
    priceId,
  })

  if (!result.ok) {
    const reason = encodeURIComponent(result.error)
    return NextResponse.redirect(
      new URL(`/sign-up?error=${reason}`, req.url),
    )
  }
  return NextResponse.redirect(result.url)
}
