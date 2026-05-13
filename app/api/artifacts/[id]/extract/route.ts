import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { paywallReject } from '@/lib/auth-access'
import { processArtifactExtraction } from '@/lib/ai/extraction-worker'

// Vision extraction can take several seconds on large images.
export const maxDuration = 60

/**
 * POST /api/artifacts/:id/extract
 *
 * Manually trigger AI extraction for an artifact. Useful when inline auto-extract
 * failed or was skipped. Auth-gated — requires a valid user session.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const denied = await paywallReject(db, user.id)
  if (denied) return denied

  try {
    await processArtifactExtraction(db, id)
    return NextResponse.json({ artifactId: id, status: 'done' })
  } catch (err) {
    console.error('[extract] processArtifactExtraction failed:', err)
    return NextResponse.json({ error: 'extraction failed' }, { status: 500 })
  }
}
