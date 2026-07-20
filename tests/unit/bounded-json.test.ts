import { describe, expect, it } from 'vitest'
import { readBoundedJson } from '@/lib/http/bounded-json'

const LIMIT = 16 * 1024

function jsonOfExactly(bytes: number): string {
  const empty = JSON.stringify({ value: '' })
  return JSON.stringify({ value: 'x'.repeat(bytes - new TextEncoder().encode(empty).byteLength) })
}

describe('readBoundedJson', () => {
  it('accepts exactly 16 KiB and rejects one byte more', async () => {
    const exact = await readBoundedJson(new Request('http://localhost', {
      method: 'POST', body: jsonOfExactly(LIMIT),
    }), LIMIT)
    const overflow = await readBoundedJson(new Request('http://localhost', {
      method: 'POST', body: jsonOfExactly(LIMIT + 1),
    }), LIMIT)

    expect(exact.ok).toBe(true)
    expect(overflow).toEqual({ ok: false, error: 'payload_too_large' })
  })

  it('rejects an oversized declared length before consuming a stream', async () => {
    const body = new ReadableStream<Uint8Array>({})
    const result = await readBoundedJson({
      headers: new Headers({ 'content-length': String(LIMIT + 1) }),
      body,
    } as Request, LIMIT)

    expect(result).toEqual({ ok: false, error: 'payload_too_large' })
  })

  it('enforces observed UTF-8 bytes even when Content-Length understates them', async () => {
    const result = await readBoundedJson(new Request('http://localhost', {
      method: 'POST', body: JSON.stringify({ value: 'é'.repeat(9_000) }),
      headers: { 'content-length': '1' },
    }), LIMIT)

    expect(result).toEqual({ ok: false, error: 'payload_too_large' })
  })
})
