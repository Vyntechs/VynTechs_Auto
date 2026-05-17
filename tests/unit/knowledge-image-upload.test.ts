import { describe, it, expect, vi } from 'vitest'
import {
  uploadKnowledgeImage,
  knowledgeImageSignedUrl,
  KNOWLEDGE_IMAGE_MAX_BYTES,
  validateKnowledgeImageBytes,
} from '@/lib/storage/knowledge-image'

const SHOP_ID = '11111111-1111-1111-1111-111111111111'

describe('uploadKnowledgeImage', () => {
  it('returns a shop-scoped key under the knowledge/ namespace', async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: 'ignored' }, error: null })
    const key = await uploadKnowledgeImage({
      shopId: SHOP_ID,
      knowledgeType: 'connector',
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/jpeg',
      upload,
    })
    expect(key).toMatch(new RegExp(`^knowledge/${SHOP_ID}/connector/[0-9a-f-]+\\.jpg$`))
  })

  it('uses png extension for image/png', async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: 'ok' }, error: null })
    const key = await uploadKnowledgeImage({
      shopId: SHOP_ID,
      knowledgeType: 'wiring_diagram',
      bytes: new Uint8Array([1]),
      mimeType: 'image/png',
      upload,
    })
    expect(key).toMatch(/\.png$/)
  })

  it('uses svg extension for image/svg+xml', async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: 'ok' }, error: null })
    const key = await uploadKnowledgeImage({
      shopId: SHOP_ID,
      knowledgeType: 'wiring_diagram',
      bytes: new Uint8Array([1]),
      mimeType: 'image/svg+xml',
      upload,
    })
    expect(key).toMatch(/\.svg$/)
  })

  it('passes bytes and content-type through to storage', async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: 'ok' }, error: null })
    const bytes = new Uint8Array([7, 8, 9])
    await uploadKnowledgeImage({
      shopId: SHOP_ID,
      knowledgeType: 'connector',
      bytes,
      mimeType: 'image/jpeg',
      upload,
    })
    const [, calledBytes, opts] = upload.mock.calls[0]
    expect(calledBytes).toBe(bytes)
    expect(opts).toEqual({ contentType: 'image/jpeg', upsert: false })
  })

  it('throws when storage returns an error', async () => {
    const upload = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(
      uploadKnowledgeImage({
        shopId: SHOP_ID,
        knowledgeType: 'connector',
        bytes: new Uint8Array([1]),
        mimeType: 'image/jpeg',
        upload,
      }),
    ).rejects.toThrow(/upload failed.*boom/)
  })
})

describe('knowledgeImageSignedUrl', () => {
  it('returns the signed URL string', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://signed.example/x' },
      error: null,
    })
    const url = await knowledgeImageSignedUrl(
      `knowledge/${SHOP_ID}/connector/abc.jpg`,
      undefined,
      { createSignedUrl },
    )
    expect(url).toBe('https://signed.example/x')
  })

  it('defaults expiry to 3600s', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://x' },
      error: null,
    })
    await knowledgeImageSignedUrl('k', undefined, { createSignedUrl })
    expect(createSignedUrl).toHaveBeenCalledWith('k', 3600)
  })
})

describe('validateKnowledgeImageBytes', () => {
  it('accepts JPG with the FF D8 FF magic bytes', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    expect(validateKnowledgeImageBytes(bytes, 'image/jpeg')).toBe('ok')
  })

  it('accepts PNG with the 89 50 4E 47 magic bytes', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(validateKnowledgeImageBytes(bytes, 'image/png')).toBe('ok')
  })

  it('accepts SVG whose first non-whitespace token is <svg', () => {
    const svg = new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="..."></svg>')
    expect(validateKnowledgeImageBytes(svg, 'image/svg+xml')).toBe('ok')
  })

  it('accepts SVG without xml prolog', () => {
    const svg = new TextEncoder().encode('<svg></svg>')
    expect(validateKnowledgeImageBytes(svg, 'image/svg+xml')).toBe('ok')
  })

  it('rejects HTML pretending to be SVG', () => {
    const html = new TextEncoder().encode('<html><body><script>alert(1)</script></body></html>')
    expect(validateKnowledgeImageBytes(html, 'image/svg+xml')).toBe('bad_magic_bytes')
  })

  it('rejects JPG bytes claimed as PNG', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff])
    expect(validateKnowledgeImageBytes(bytes, 'image/png')).toBe('bad_magic_bytes')
  })

  it('rejects an unsupported MIME type', () => {
    expect(validateKnowledgeImageBytes(new Uint8Array([1]), 'application/pdf')).toBe('bad_mime_type')
  })

  it('rejects bytes larger than the max size', () => {
    const huge = new Uint8Array(KNOWLEDGE_IMAGE_MAX_BYTES + 1)
    huge[0] = 0xff
    huge[1] = 0xd8
    huge[2] = 0xff
    expect(validateKnowledgeImageBytes(huge, 'image/jpeg')).toBe('too_large')
  })
})
