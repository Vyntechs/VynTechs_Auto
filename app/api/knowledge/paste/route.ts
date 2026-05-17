import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCurator } from '@/lib/curator/route-helpers'
import { classifyPaste } from '@/lib/knowledge/classify-paste'
import { verifySourceSpans } from '@/lib/knowledge/verify-source-spans'

const PasteSchema = z.object({
  rawText: z.string().min(1).max(20_000),
  scopeHint: z.string().max(500).optional(),
})

// POST /api/knowledge/paste — owner-only assist for simple-type knowledge
// entries. Returns a structured proposal the owner reviews and edits before
// hitting /api/knowledge/save. Output passes through verifySourceSpans —
// fields whose receipts can't be ground-truthed against the paste are stripped.
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

    if (result.status === 'paste_too_short') {
      return NextResponse.json({
        status: 'paste_too_short',
        draft: {},
        sourceSpans: {},
        stripped: [],
        unverified: [],
        message: 'Paste too short to assist — fill the form manually.',
      })
    }

    if (result.status === 'failed') {
      return NextResponse.json({
        status: 'failed',
        draft: result.draft,
        sourceSpans: result.sourceSpans,
        stripped: [],
        unverified: [],
        llmNotes: result.llmNotes,
      })
    }

    const verified = verifySourceSpans(parsed.data.rawText, result.draft, result.sourceSpans)
    return NextResponse.json({
      status: 'parsed',
      draft: verified.draft,
      sourceSpans: verified.sourceSpans,
      stripped: verified.stripped,
      unverified: verified.unverified,
      llmNotes: result.llmNotes,
    })
  } catch (err) {
    return NextResponse.json(
      {
        error: 'classifier_failed',
        message: err instanceof Error ? err.message : 'unknown classifier error',
      },
      { status: 502 },
    )
  }
}
