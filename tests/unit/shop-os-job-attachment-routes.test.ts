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

import { POST } from '@/app/api/tickets/[id]/jobs/[jobId]/attachments/route'
import { GET } from '@/app/api/tickets/[id]/jobs/[jobId]/attachments/[attachmentId]/route'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { createJobAttachment, getJobAttachmentProof } from '@/lib/shop-os/simple-work'
import { downloadJobAttachment, removeJobAttachment, uploadJobAttachment } from '@/lib/storage/client'

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

  it('preserves the non-null shop boundary before the common media response', async () => {
    vi.mocked(requireUserAndProfile).mockResolvedValue({
      user: { id: profile.userId },
      profile: { ...profile, shopId: null },
    } as never)
    const request = { headers: { get: () => null }, formData: vi.fn() } as unknown as Request

    const response = await POST(request, postParams)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not_found' })
    expect(request.formData).not.toHaveBeenCalled()
  })

  it('closes upload before params, multipart, domain, or storage work', async () => {
    const request = { headers: { get: vi.fn() }, formData: vi.fn() } as unknown as Request
    const params = { then: vi.fn() } as unknown as Promise<{ id: string; jobId: string }>

    const response = await POST(request, { params })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not_available' })
    expect(request.headers.get).not.toHaveBeenCalled()
    expect(request.formData).not.toHaveBeenCalled()
    expect(params.then).not.toHaveBeenCalled()
    expect(createJobAttachment).not.toHaveBeenCalled()
    expect(uploadJobAttachment).not.toHaveBeenCalled()
    expect(removeJobAttachment).not.toHaveBeenCalled()
  })

  it('closes download before params, domain, or storage work', async () => {
    const params = { then: vi.fn() } as unknown as Promise<{ id: string; jobId: string; attachmentId: string }>

    const response = await GET(new Request('http://localhost/proof'), { params })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not_available' })
    expect(params.then).not.toHaveBeenCalled()
    expect(getJobAttachmentProof).not.toHaveBeenCalled()
    expect(downloadJobAttachment).not.toHaveBeenCalled()
  })
})
