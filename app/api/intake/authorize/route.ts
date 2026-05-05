import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'

type AuthorizeBody = {
  draftId?: string
  writerNote?: string
  lines?: unknown[]
  steps?: unknown[]
}

// Placeholder. Counter 04 replaces this with a real handler that
// persists a WorkOrder record and returns the live id.
export async function POST(req: Request) {
  let body: AuthorizeBody
  try {
    body = (await req.json()) as AuthorizeBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  void body
  return NextResponse.json({ workOrderId: `WO-${randomUUID()}` }, { status: 201 })
}
