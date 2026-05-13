import { redirect } from 'next/navigation'
import { stripe } from '@/lib/stripe'

/** Post-checkout landing. Stripe routes here after the user completes
 *  payment with `?session_id={CHECKOUT_SESSION_ID}` filled in. We confirm
 *  the session is `complete` (status the subscription transitions into the
 *  moment Stripe creates the subscription record), then send the user
 *  straight into the app. The webhook updates `stripeCustomers` async; the
 *  paywall middleware (PR 5) will handle the freshly-paid race window on
 *  its own. */
type SearchParams = Promise<{ session_id?: string }>

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { session_id } = await searchParams
  if (!session_id) redirect('/sign-in')

  let isComplete = false
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id)
    isComplete = session.status === 'complete'
  } catch {
    // Stripe lookup failed — fall through to the cancel path.
  }

  // redirect() throws NEXT_REDIRECT; calling it inside the try/catch above
  // would have the catch swallow the redirect. Keep it outside.
  if (isComplete) redirect('/today')
  redirect('/sign-up?canceled=true')
}
