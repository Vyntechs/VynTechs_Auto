import { NextResponse } from 'next/server'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { db } from '@/lib/db/client'
import { getJobAttachmentProof, type SimpleWorkFailure } from '@/lib/shop-os/simple-work'
import { downloadJobAttachment } from '@/lib/storage/client'
import { getServerSupabase } from '@/lib/supabase-server'

function failureResponse(result: SimpleWorkFailure) {
  const status = result.error === 'invalid_input' ? 400
    : result.error === 'not_found' ? 404
      : 409
  return NextResponse.json(
    { error: result.error, ...(result.retryable ? { retryable: true } : {}) },
    { status },
  )
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; jobId: string; attachmentId: string }> },
) {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied
  if (!ctx.profile.shopId) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const { id, jobId, attachmentId } = await params
  const result = await getJobAttachmentProof(db, {
    actor: { profileId: ctx.profile.id, shopId: ctx.profile.shopId },
    ticketId: id,
    jobId,
    attachmentId,
  }, { download: downloadJobAttachment })
  if (!result.ok) return failureResponse(result)
  const body = Uint8Array.from(result.file.bytes).buffer
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': result.file.mimeType,
      'content-length': String(result.file.bytes.byteLength),
      'cache-control': 'private, max-age=60',
      'x-content-type-options': 'nosniff',
    },
  })
}
