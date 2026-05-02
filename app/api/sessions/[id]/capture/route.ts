import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { captureArtifact } from '@/lib/sessions'
import { getServerSupabase } from '@/lib/supabase-server'
import { uploadArtifact } from '@/lib/storage/client'
import { createArtifact } from '@/lib/db/queries'
import { processArtifactExtraction } from '@/lib/ai/extraction-worker'

export async function POST(
  req: Request,
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

  const form = await req.formData().catch(() => null)
  if (!form) {
    return NextResponse.json({ error: 'multipart required' }, { status: 400 })
  }

  const file = form.get('file')
  const kind = String(form.get('kind') ?? '')
  const nodeId = form.get('nodeId') ? String(form.get('nodeId')) : undefined
  const durationMs = form.get('durationMs') ? Number(form.get('durationMs')) : undefined

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'file required' }, { status: 400 })
  }

  const bytes = new Uint8Array(await file.arrayBuffer())

  const result = await captureArtifact({
    db,
    userId: user.id,
    sessionId: id,
    kind,
    nodeId,
    file: { bytes, mimeType: file.type, size: file.size },
    durationMs,
    uploadArtifact,
    createArtifact,
    processExtraction: processArtifactExtraction,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ artifactId: result.artifactId, storageKey: result.storageKey, kind: result.kind, extractionStatus: result.extractionStatus })
}
