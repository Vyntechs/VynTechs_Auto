import { NextResponse } from 'next/server'

/**
 * Retired generic creation entrance.
 *
 * Current product flows use the constrained `/api/tickets/quick` and
 * `/api/tickets/counter` handlers. Keeping the old low-level creator reachable
 * would let clients bypass those operation-specific controls.
 */
export async function POST(_req: Request) {
  return NextResponse.json({ error: 'not_found' }, { status: 404 })
}
