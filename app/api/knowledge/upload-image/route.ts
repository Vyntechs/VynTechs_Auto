import { NextResponse } from 'next/server'
import { requireCurator } from '@/lib/curator/route-helpers'
import {
  uploadKnowledgeImage,
  knowledgeImageSignedUrl,
  validateKnowledgeImageBytes,
  KNOWLEDGE_IMAGE_MAX_BYTES,
  type KnowledgeImageType,
} from '@/lib/storage/knowledge-image'

// Image uploads can be 10MB and span a coast-to-coast round trip; give the
// route a generous-but-bounded budget. Matches the maxDuration set on the
// session capture route.
export const maxDuration = 60

const ALLOWED_TYPES: ReadonlySet<KnowledgeImageType> = new Set(['connector', 'wiring_diagram'])

function isKnowledgeImageType(s: string): s is KnowledgeImageType {
  return ALLOWED_TYPES.has(s as KnowledgeImageType)
}

export async function POST(req: Request) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response

  const form = await req.formData().catch(() => null)
  if (!form) {
    return NextResponse.json({ error: 'multipart_required' }, { status: 400 })
  }

  const knowledgeTypeRaw = form.get('knowledgeType')
  if (typeof knowledgeTypeRaw !== 'string' || !isKnowledgeImageType(knowledgeTypeRaw)) {
    return NextResponse.json(
      { error: 'invalid_input', message: 'knowledgeType must be "connector" or "wiring_diagram"' },
      { status: 422 },
    )
  }
  const knowledgeType = knowledgeTypeRaw

  const file = form.get('file')
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'invalid_input', message: 'file field required' }, { status: 422 })
  }
  if (file.size > KNOWLEDGE_IMAGE_MAX_BYTES) {
    return NextResponse.json(
      { error: 'too_large', message: `file exceeds ${KNOWLEDGE_IMAGE_MAX_BYTES} bytes` },
      { status: 422 },
    )
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const baseMime = file.type.split(';')[0].trim()

  const validation = validateKnowledgeImageBytes(bytes, baseMime)
  if (validation !== 'ok') {
    return NextResponse.json(
      { error: 'invalid_input', reason: validation },
      { status: 422 },
    )
  }

  let storageKey: string
  try {
    storageKey = await uploadKnowledgeImage({
      shopId: auth.shopId,
      knowledgeType,
      bytes,
      mimeType: baseMime,
    })
  } catch (err) {
    return NextResponse.json(
      { error: 'upload_failed', message: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    )
  }

  let signedUrl: string
  try {
    signedUrl = await knowledgeImageSignedUrl(storageKey)
  } catch (err) {
    // The upload succeeded — return the key with no signedUrl. The UI can
    // request one later, and the row references the key anyway.
    return NextResponse.json(
      {
        storageKey,
        signedUrl: null,
        signedUrlError: err instanceof Error ? err.message : 'unknown',
      },
      { status: 201 },
    )
  }

  return NextResponse.json({ storageKey, signedUrl }, { status: 201 })
}
