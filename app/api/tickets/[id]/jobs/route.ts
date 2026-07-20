import { NextResponse } from 'next/server'

/**
 * Retired public add-job entrance.
 *
 * The current product creates work through constrained counter intake and
 * idempotent canned-quote operations. The underlying domain helper remains
 * available to those server-owned workflows, but arbitrary clients may not
 * append unbounded jobs to an existing repair order.
 */
export async function POST(
  _req: Request,
  _context: { params: Promise<{ id: string }> },
) {
  return NextResponse.json({ error: 'not_found' }, { status: 404 })
}
