import { NextResponse } from 'next/server'

// Public process/deployment liveness only. Database readiness belongs in
// authenticated monitoring; putting it here lets anonymous traffic amplify
// database work and turns a liveness check into infrastructure discovery.
export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 })
}
