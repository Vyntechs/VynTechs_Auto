import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { runCalibrationAnalysis } from '@/lib/calibration/run-weekly'

// Vercel Cron sends GETs with `Authorization: Bearer ${CRON_SECRET}` when
// CRON_SECRET is set. Local dev without the secret stays open for ad-hoc
// testing — same gate as comeback-prompts-daily.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const got = req.headers.get('authorization')
    if (got !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  const result = await runCalibrationAnalysis(db)
  return NextResponse.json(result)
}
