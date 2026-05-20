import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { surfaceDueFollowUps } from '@/lib/comeback/surface'
import { authorizeCronRequest } from '@/lib/cron-auth'

// Vercel Cron sends GETs with `Authorization: Bearer ${CRON_SECRET}`.
// The secret is mandatory in production — see lib/cron-auth.ts.
export async function GET(req: Request) {
  const auth = authorizeCronRequest({
    authorizationHeader: req.headers.get('authorization'),
    secret: process.env.CRON_SECRET,
    nodeEnv: process.env.NODE_ENV,
  })
  if (auth.kind === 'deny') {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const result = await surfaceDueFollowUps(db)
  return NextResponse.json(result)
}
