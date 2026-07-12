import { NextResponse } from 'next/server'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { db } from '@/lib/db/client'
import { createJobAttachment, type SimpleWorkFailure } from '@/lib/shop-os/simple-work'
import { removeJobAttachment, uploadJobAttachment } from '@/lib/storage/client'
import { getServerSupabase } from '@/lib/supabase-server'

export const MAX_JOB_MULTIPART_BYTES = 4_500_000
export const maxDuration = 30

function failureResponse(result: SimpleWorkFailure) {
  const status = result.error === 'invalid_input' ? 400
    : result.error === 'not_found' ? 404
      : 409
  return NextResponse.json(
    { error: result.error, ...(result.retryable ? { retryable: true } : {}) },
    { status },
  )
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; jobId: string }> },
) {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied
  if (!ctx.profile.shopId) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const contentLength = req.headers.get('content-length')
  if (contentLength !== null) {
    const parsedLength = Number(contentLength)
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
    }
    if (parsedLength > MAX_JOB_MULTIPART_BYTES) {
      return NextResponse.json({ error: 'payload_too_large' }, { status: 413 })
    }
  }
  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  const allowed = new Set(['requestKey', 'kind', 'file'])
  if ([...form.keys()].some((key) => !allowed.has(key))
    || form.getAll('requestKey').length !== 1
    || form.getAll('kind').length !== 1
    || form.getAll('file').length !== 1) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  const bytes = new Uint8Array(await file.arrayBuffer())
  const { id, jobId } = await params
  const result = await createJobAttachment(db, {
    actor: { profileId: ctx.profile.id, shopId: ctx.profile.shopId },
    ticketId: id,
    jobId,
    requestKey: String(form.get('requestKey') ?? ''),
    kind: String(form.get('kind') ?? ''),
    file: { bytes, mimeType: file.type, size: file.size },
  }, {
    upload: uploadJobAttachment,
    remove: removeJobAttachment,
  })
  return result.ok
    ? NextResponse.json(
        { changed: result.changed, attachment: result.attachment },
        { status: result.changed ? 201 : 200 },
      )
    : failureResponse(result)
}
