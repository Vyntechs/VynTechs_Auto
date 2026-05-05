import { describe, it, expect } from 'vitest'
import { POST } from '@/app/api/intake/authorize/route'

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/intake/authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/intake/authorize (Counter 03 stub)', () => {
  it('returns 201 + a non-empty workOrderId for any well-formed body', async () => {
    const res = await POST(
      postReq({ draftId: 'draft-abc', writerNote: 'note', lines: [], steps: [] }),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { workOrderId?: string }
    expect(typeof body.workOrderId).toBe('string')
    expect(body.workOrderId).toBeTruthy()
  })

  it('returns 400 on invalid JSON', async () => {
    const res = await POST(postReq('not-json'))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toBe('invalid_json')
  })
})
