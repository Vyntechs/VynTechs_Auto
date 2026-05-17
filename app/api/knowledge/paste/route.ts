import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCurator } from '@/lib/curator/route-helpers'
import { classifyPaste } from '@/lib/knowledge/classify-paste'

const PasteSchema = z.object({
  rawText: z.string().min(1).max(20_000),
  scopeHint: z.string().max(500).optional(),
})

// POST /api/knowledge/paste — owner-only AI assist for simple-type knowledge
// entries. Returns a structured proposal the owner reviews and edits before
// hitting /api/knowledge/save.
export async function POST(req: Request) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response

  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = PasteSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_input', issues: parsed.error.issues },
      { status: 422 },
    )
  }

  try {
    const result = await classifyPaste(parsed.data)
    return NextResponse.json(result)
  } catch (err) {
    // Classifier failed (Haiku error, malformed JSON). Surface explicitly
    // so the UI can show "AI assist unavailable; fill the form yourself"
    // rather than silently treating the empty draft as the proposal.
    return NextResponse.json(
      {
        error: 'classifier_failed',
        message: err instanceof Error ? err.message : 'unknown classifier error',
      },
      { status: 502 },
    )
  }
}
