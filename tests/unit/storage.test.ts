import { describe, it, expect, vi } from 'vitest'

import {
  uploadArtifact,
  signedUrl,
  downloadArtifact,
  uploadJobAttachment,
  removeJobAttachment,
  downloadJobAttachment,
} from '@/lib/storage/client'

// All tests inject mocks via DI. The lazy-Proxy real client is never reached,
// so no NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env is required.

describe('uploadArtifact', () => {
  it('returns a key namespaced by sessionId and kind', async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: 'ignored' }, error: null })
    const key = await uploadArtifact({
      sessionId: 'sess-abc',
      kind: 'photo',
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/jpeg',
      upload,
    })
    expect(key).toMatch(/^sess-abc\/photo\/[0-9a-f-]+\.jpg$/)
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('passes the resolved key, bytes, and content-type to the storage client', async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: 'ok' }, error: null })
    const bytes = new Uint8Array([4, 5, 6])
    await uploadArtifact({
      sessionId: 'sess-1',
      kind: 'audio',
      bytes,
      mimeType: 'audio/webm',
      upload,
    })
    const [calledKey, calledBytes, opts] = upload.mock.calls[0]
    expect(calledKey).toMatch(/^sess-1\/audio\/.+\.webm$/)
    expect(calledBytes).toBe(bytes)
    expect(opts).toEqual({ contentType: 'audio/webm', upsert: false })
  })

  it('strips mime codec parameters before extension lookup', async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: 'ok' }, error: null })
    const key = await uploadArtifact({
      sessionId: 's',
      kind: 'audio',
      bytes: new Uint8Array([1]),
      mimeType: 'audio/webm;codecs=opus',
      upload,
    })
    expect(key).toMatch(/\.webm$/)
  })

  it('falls back to .bin extension for unknown mime types', async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: 'ok' }, error: null })
    const key = await uploadArtifact({
      sessionId: 's',
      kind: 'photo',
      bytes: new Uint8Array([1]),
      mimeType: 'application/octet-stream',
      upload,
    })
    expect(key).toMatch(/\.bin$/)
  })

  it('throws when the storage client returns an error', async () => {
    const upload = vi.fn().mockResolvedValue({ data: null, error: { message: 'quota exceeded' } })
    await expect(
      uploadArtifact({
        sessionId: 's',
        kind: 'photo',
        bytes: new Uint8Array([1]),
        mimeType: 'image/jpeg',
        upload,
      }),
    ).rejects.toThrow(/upload failed.*quota exceeded/)
  })
})

describe('signedUrl', () => {
  it('returns the URL string from the storage client', async () => {
    const createSignedUrl = vi
      .fn()
      .mockResolvedValue({ data: { signedUrl: 'https://signed.example/x' }, error: null })
    const url = await signedUrl('sess/abc/photo.jpg', undefined, { createSignedUrl })
    expect(url).toBe('https://signed.example/x')
  })

  it('forwards the storage key and default expiry of 3600s', async () => {
    const createSignedUrl = vi
      .fn()
      .mockResolvedValue({ data: { signedUrl: 'https://x' }, error: null })
    await signedUrl('sess/abc/photo.jpg', undefined, { createSignedUrl })
    expect(createSignedUrl).toHaveBeenCalledWith('sess/abc/photo.jpg', 3600)
  })

  it('forwards a caller-supplied expiry', async () => {
    const createSignedUrl = vi
      .fn()
      .mockResolvedValue({ data: { signedUrl: 'https://x' }, error: null })
    await signedUrl('k', 60, { createSignedUrl })
    expect(createSignedUrl).toHaveBeenCalledWith('k', 60)
  })

  it('throws when the storage client returns an error', async () => {
    const createSignedUrl = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'not found' } })
    await expect(
      signedUrl('missing', undefined, { createSignedUrl }),
    ).rejects.toThrow(/signed url failed.*not found/)
  })

  it('throws when the storage client returns no data and no error', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({ data: null, error: null })
    await expect(
      signedUrl('k', undefined, { createSignedUrl }),
    ).rejects.toThrow(/signed url failed.*no data/)
  })
})

describe('downloadArtifact', () => {
  it('returns the bytes from the storage client', async () => {
    const blob = new Blob([new Uint8Array([7, 8, 9])])
    const download = vi.fn().mockResolvedValue({ data: blob, error: null })
    const out = await downloadArtifact('sess/abc/photo.jpg', { download })
    expect(out).toEqual(new Uint8Array([7, 8, 9]))
    expect(download).toHaveBeenCalledWith('sess/abc/photo.jpg')
  })

  it('throws when the storage client returns an error', async () => {
    const download = vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } })
    await expect(
      downloadArtifact('missing', { download }),
    ).rejects.toThrow(/download failed.*not found/)
  })

  it('throws when the storage client returns no data and no error', async () => {
    const download = vi.fn().mockResolvedValue({ data: null, error: null })
    await expect(
      downloadArtifact('k', { download }),
    ).rejects.toThrow(/download failed.*no data/)
  })
})

describe('private job attachment storage', () => {
  it('uses an idempotent content-type-preserving upload', async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: 'proof' }, error: null })
    const bytes = new Uint8Array([1, 2, 3])
    await uploadJobAttachment({ storageKey: 'shop/jobs/job/proof/id/hash.jpg', bytes, mimeType: 'image/jpeg', upload })
    expect(upload).toHaveBeenCalledWith('shop/jobs/job/proof/id/hash.jpg', bytes, {
      contentType: 'image/jpeg', upsert: true,
    })
  })

  it('removes only the requested proof object', async () => {
    const remove = vi.fn().mockResolvedValue({ data: [], error: null })
    await removeJobAttachment('shop/jobs/job/proof/id/hash.jpg', { remove })
    expect(remove).toHaveBeenCalledWith(['shop/jobs/job/proof/id/hash.jpg'])
  })

  it('downloads private proof without creating a signed URL', async () => {
    const download = vi.fn().mockResolvedValue({ data: new Blob([new Uint8Array([7, 8])]), error: null })
    await expect(downloadJobAttachment('private-proof', { download })).resolves.toEqual(new Uint8Array([7, 8]))
  })
})
