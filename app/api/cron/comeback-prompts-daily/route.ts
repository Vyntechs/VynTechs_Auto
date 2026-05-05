import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { surfaceDueFollowUps } from '@/lib/comeback/surface'

// Vercel Cron sends GETs with an Authorization: Bearer ${CRON_SECRET}
// header when CRON_SECRET is set in the project env. We only enforce
// the auth gate when the secret is configured — local dev (where the
// env is unset) hits localhost only and stays open for ad-hoc testing.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const got = req.headers.get('authorization')
    if (got !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  const result = await surfaceDueFollowUps(db)
  return NextResponse.json(result)
}
