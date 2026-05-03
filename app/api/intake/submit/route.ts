import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'

type SubmitBody = {
  customer?: { name?: string }
  vehicle?: { vin?: string }
  complaint?: { description?: string }
}

// Placeholder. Counter 04 (AI plan & quote) replaces this with a real
// handler in lib/intake.ts that persists a WorkOrderDraft and kicks
// off the AI plan stream.
export async function POST(req: Request) {
  let body: SubmitBody
  try {
    body = (await req.json()) as SubmitBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const name = body.customer?.name?.trim()
  const vin = body.vehicle?.vin?.trim()
  const description = body.complaint?.description?.trim()
  if (!name || !vin || !description) {
    return NextResponse.json(
      { error: 'name, vin, and complaint description are required' },
      { status: 422 },
    )
  }

  return NextResponse.json({ draftId: randomUUID() }, { status: 201 })
}
