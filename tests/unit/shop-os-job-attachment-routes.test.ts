import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/shop-os/simple-work', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shop-os/simple-work')>()
  return { ...actual, createJobAttachment: vi.fn(), getJobAttachmentProof: vi.fn() }
})
vi.mock('@/lib/storage/client', () => ({
  uploadJobAttachment: vi.fn(),
  removeJobAttachment: vi.fn(),
  downloadJobAttachment: vi.fn(),
}))

import { POST, MAX_JOB_MULTIPART_BYTES } from '@/app/api/tickets/[id]/jobs/[jobId]/attachments/route'
import { GET } from '@/app/api/tickets/[id]/jobs/[jobId]/attachments/[attachmentId]/route'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { createJobAttachment, getJobAttachmentProof } from '@/lib/shop-os/simple-work'

const TICKET = '00000000-0000-4000-8000-000000000020'
const JOB = '00000000-0000-4000-8000-000000000030'
const ATTACHMENT = '00000000-0000-4000-8000-000000000080'
const profile = {
  id: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000101',
  shopId: '00000000-0000-4000-8000-000000000201',
}
const postParams = { params: Promise.resolve({ id: TICKET, jobId: JOB }) }
const getParams = { params: Promise.resolve({ id: TICKET, jobId: JOB, attachmentId: ATTACHMENT }) }

describe('Shop OS job attachment routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUserAndProfile).mockResolvedValue({ user: { id: profile.userId }, profile } as never)
    vi.mocked(paywallReject).mockResolvedValue(null)
  })

  it('rejects an unauthenticated upload before parsing or storage work', async () => {
    vi.mocked(requireUserAndProfile).mockResolvedValue(null)
    const request = { headers: { get: () => null }, formData: vi.fn() } as unknown as Request
    const response = await POST(request, postParams)
    expect(response.status).toBe(401)
    expect(request.formData).not.toHaveBeenCalled()
    expect(createJobAttachment).not.toHaveBeenCalled()
  })

  it('rejects excessive multipart length before parsing or domain work', async () => {
    expect(MAX_JOB_MULTIPART_BYTES).toBe(4_500_000)
    const request = {
      headers: { get: (name: string) => name === 'content-length' ? '4500001' : null },
      formData: vi.fn(),
    } as unknown as Request
    const response = await POST(request, postParams)
    expect(response.status).toBe(413)
    expect(request.formData).not.toHaveBeenCalled()
    expect(createJobAttachment).not.toHaveBeenCalled()
  })

  it('passes bounded multipart bytes and returns safe attachment metadata', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    const form = new FormData()
    form.set('requestKey', ATTACHMENT)
    form.set('kind', 'photo')
    form.set('file', new Blob([bytes], { type: 'image/jpeg' }))
    vi.mocked(createJobAttachment).mockResolvedValue({
      ok: true, changed: true,
      attachment: { id: ATTACHMENT, kind: 'photo', mimeType: 'image/jpeg', byteSize: 4, createdAt: '2026-07-11T12:00:00.000Z' },
    })
    const response = await POST(new Request('http://localhost/upload', { method: 'POST', body: form }), postParams)
    expect(response.status).toBe(201)
    expect(createJobAttachment).toHaveBeenCalledWith({}, expect.objectContaining({
      actor: { profileId: profile.id, shopId: profile.shopId },
      ticketId: TICKET, jobId: JOB, requestKey: ATTACHMENT, kind: 'photo',
      file: expect.objectContaining({ mimeType: 'image/jpeg', size: 4 }),
    }), expect.objectContaining({ upload: expect.any(Function), remove: expect.any(Function) }))
    expect(await response.json()).toEqual({
      changed: true,
      attachment: { id: ATTACHMENT, kind: 'photo', mimeType: 'image/jpeg', byteSize: 4, createdAt: '2026-07-11T12:00:00.000Z' },
    })
  })

  it('proxies bounded proof bytes with private defensive headers', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff])
    vi.mocked(getJobAttachmentProof).mockResolvedValue({
      ok: true, file: { bytes, mimeType: 'image/jpeg' },
    })
    const response = await GET(new Request('http://localhost/proof'), getParams)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('cache-control')).toBe('private, max-age=60')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
  })
})
