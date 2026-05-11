import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db/client'
import { requireCurator } from '@/lib/curator/route-helpers'
import { promoteFounderNote } from '@/lib/founder/queue-actions'

// Promotion is curator-gated (not founder-gated) because the act of
// promoting is the review step — and the founder is also a curator.
// This keeps the door open for a delegated reviewer later without
// requiring auth changes.
const PromoteSchema = z.object({
  input: z.object({
    vehicleYear: z.number().int().min(1900).max(2100),
    vehicleMake: z.string().min(1),
    vehicleModel: z.string().min(1),
    vehicleEngine: z.string().min(1),
    symptomTags: z.array(z.string()),
    dtcs: z.array(z.string()),
    summary: z.string().min(1),
    freezeFramePattern: z.record(z.string(), z.union([z.string(), z.number()])),
    rootCause: z.string().min(1),
    actionType: z.enum([
      'part_replacement',
      'repair',
      'adjustment',
      'cleaning',
      'no_fix',
      'referred',
    ]),
    partInfo: z
      .object({
        name: z.string().optional(),
        oemNumber: z.string().optional(),
        cost: z.number().optional(),
      })
      .nullable(),
    verification: z.object({
      codesCleared: z.boolean(),
      testDrive: z.boolean(),
      symptomsResolved: z.enum(['yes', 'no', 'partial']),
    }),
  }),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response

  const { id } = await params

  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = PromoteSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_input', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const result = await promoteFounderNote(db, id, auth.profileId, parsed.data.input)

  if (result.kind === 'not_found') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (result.kind === 'already_reviewed') {
    return NextResponse.json({ error: 'already_reviewed' }, { status: 409 })
  }

  return NextResponse.json({ ok: true, corpusEntryId: result.corpusEntryId })
}
