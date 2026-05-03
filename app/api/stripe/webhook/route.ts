import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { handleStripeWebhook } from '@/lib/stripe'

export async function POST(req: Request) {
  const body = await req.text()
  const result = await handleStripeWebhook({
    db,
    body,
    signature: req.headers.get('stripe-signature'),
    secret: process.env.STRIPE_WEBHOOK_SECRET,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ received: true, eventType: result.eventType })
}
