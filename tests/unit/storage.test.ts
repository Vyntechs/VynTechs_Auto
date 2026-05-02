import { describe, it, expect, vi } from 'vitest'

const supabaseMock = {
  storage: {
    from: vi.fn().mockReturnValue({
      upload: vi.fn().mockResolvedValue({ data: { path: 'sess/abc/photo.jpg' }, error: null }),
      createSignedUrl: vi.fn().mockResolvedValue({
        data: { signedUrl: 'https://signed.example/x' },
        error: null,
      }),
    }),
  },
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => supabaseMock,
}))

describe('storage', () => {
  it('uploadArtifact returns the storage key', async () => {
    const { uploadArtifact } = await import('@/lib/storage/client')
    const key = await uploadArtifact({
      sessionId: 'abc',
      kind: 'photo',
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/jpeg',
    })
    expect(key).toContain('abc/')
  })

  it('signedUrl returns the URL string', async () => {
    const { signedUrl } = await import('@/lib/storage/client')
    const url = await signedUrl('sess/abc/photo.jpg')
    expect(url).toBe('https://signed.example/x')
  })
})
