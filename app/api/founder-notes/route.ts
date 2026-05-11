import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db/client'
import { requireFounder } from '@/lib/founder/route-helpers'
import { structureFounderNote } from '@/lib/founder/structure-note'
import { enqueueFounderNote } from '@/lib/founder/queue-actions'

const SubmitSchema = z.object({
  rawText: z.string().min(1).max(8000),
})

/**
 * Submit a free-form founder note. The structurer LLM extracts what it
 * can; the row is enqueued regardless of parse status (per the founder's
 * stated workflow: every note goes through review). Returns the queue
 * row id so the founder can navigate straight to the review screen if
 * they want to confirm immediately.
 */
export async function POST(req: Request) {
  const auth = await requireFounder()
  if (auth.kind === 'forbidden') return auth.response

  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = SubmitSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_input', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  let structureResult
  try {
    structureResult = await structureFounderNote(parsed.data.rawText)
  } catch (err) {
    // Structurer failed (LLM error, malformed JSON). Preserve the raw
    // text in the queue with a 'failed' status so the founder can still
    // review and salvage it manually — no note is ever lost.
    structureResult = {
      status: 'failed' as const,
      draft: {},
      missingFields: [
        'vehicleYear',
        'vehicleMake',
        'vehicleModel',
        'vehicleEngine',
        'rootCause',
        'summary',
        'actionType',
      ],
      llmNotes: `Auto-structuring failed: ${
        err instanceof Error ? err.message : 'unknown error'
      }`,
    }
  }

  const result = await enqueueFounderNote(db, {
    rawText: parsed.data.rawText,
    createdByUserId: auth.profileId,
    structureResult,
  })

  return NextResponse.json({
    ok: true,
    id: result.id,
    parseStatus: structureResult.status,
    missingFields: structureResult.missingFields,
  })
}
