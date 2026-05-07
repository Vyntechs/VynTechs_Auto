import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db/client'
import { createCuratorCorpusEntry } from '@/lib/curator/corpus-actions'
import { requireCurator } from '@/lib/curator/route-helpers'

const CorpusInputSchema = z.object({
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
    actionType: z.enum(['part_replacement', 'repair', 'adjustment', 'cleaning', 'no_fix', 'referred']),
    partInfo: z.object({
      name: z.string().optional(),
      oemNumber: z.string().optional(),
      cost: z.number().optional(),
    }).nullable(),
    verification: z.object({
      codesCleared: z.boolean(),
      testDrive: z.boolean(),
      symptomsResolved: z.enum(['yes', 'no', 'partial']),
    }),
  }),
  fromQueueEntryId: z.string().uuid().optional(),
})

export async function POST(req: Request) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response

  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = CorpusInputSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues }, { status: 400 })
  }

  const result = await createCuratorCorpusEntry(
    db,
    auth.profileId,
    parsed.data.input,
    parsed.data.fromQueueEntryId ? { fromQueueEntryId: parsed.data.fromQueueEntryId } : {},
  )
  if (result.kind !== 'ok') {
    return NextResponse.json({ error: result.reason }, { status: 400 })
  }
  return NextResponse.json({ ok: true, id: result.id })
}
