import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { processArtifactExtraction } from '@/lib/ai/extraction-worker'

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

  try {
    await processArtifactExtraction(db, id)
    return NextResponse.json({ artifactId: id, status: 'done' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: 'extraction failed', detail: message },
      { status: 500 },
    )
  }
}
