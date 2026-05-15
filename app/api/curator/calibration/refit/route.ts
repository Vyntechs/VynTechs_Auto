import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { triggerCalibrationAnalysis } from '@/lib/calibration/manual-trigger'

export async function POST() {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const outcome = await triggerCalibrationAnalysis({
    db,
    userId: user?.id ?? null,
    userEmail: user?.email ?? null,
  })
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status })
  }
  return NextResponse.json(outcome.result)
}
