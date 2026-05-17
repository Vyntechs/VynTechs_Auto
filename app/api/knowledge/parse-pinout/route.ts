import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCurator } from '@/lib/curator/route-helpers'
import { parsePinout } from '@/lib/knowledge/parse-pinout'

const InputSchema = z.object({
  rawText: z.string().min(1).max(40_000),
  connectorHint: z.string().max(200).optional(),
})

export const maxDuration = 30

export async function POST(req: Request) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response

  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsedInput = InputSchema.safeParse(json)
  if (!parsedInput.success) {
    return NextResponse.json(
      { error: 'invalid_input', issues: parsedInput.error.issues },
      { status: 422 },
    )
  }

  try {
    const result = await parsePinout(parsedInput.data)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: 'parser_failed', message: err instanceof Error ? err.message : 'unknown' },
      { status: 502 },
    )
  }
}
