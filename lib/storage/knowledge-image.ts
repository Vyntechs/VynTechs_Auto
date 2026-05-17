import { randomUUID } from 'node:crypto'
import { supabase } from '@/lib/storage/client'
import type {
  StorageUploadFn,
  StorageCreateSignedUrlFn,
} from '@/lib/storage/client'

// Knowledge images reuse the existing 'artifacts' Supabase Storage bucket
// (see lib/storage/client.ts). Access control is enforced at the route layer
// (requireCurator) plus the shop-scoped path namespace below; the bucket runs
// with the service-role client. Per the PR 3 design doc, this is intentional
// — a second bucket would not change the effective security model.

const BUCKET = 'artifacts'

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
}

export const KNOWLEDGE_IMAGE_MAX_BYTES = 10 * 1024 * 1024 // 10 MB per spec
export const KNOWLEDGE_IMAGE_ALLOWED_MIME = Object.keys(MIME_TO_EXT) as readonly string[]

export type KnowledgeImageType = 'connector' | 'wiring_diagram'

export type ValidationResult = 'ok' | 'bad_mime_type' | 'bad_magic_bytes' | 'too_large'

// Magic-byte validation — defends against HTML-with-.svg-extension tricks
// and MIME-spoofing. SVG must be rendered via <img> tags only (per the
// PR 3 design doc); never inline-embed.
export function validateKnowledgeImageBytes(
  bytes: Uint8Array,
  mimeType: string,
): ValidationResult {
  if (!(mimeType in MIME_TO_EXT)) return 'bad_mime_type'
  if (bytes.byteLength > KNOWLEDGE_IMAGE_MAX_BYTES) return 'too_large'

  if (mimeType === 'image/jpeg') {
    if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      return 'bad_magic_bytes'
    }
    return 'ok'
  }
  if (mimeType === 'image/png') {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    if (bytes.length < sig.length) return 'bad_magic_bytes'
    for (let i = 0; i < sig.length; i++) {
      if (bytes[i] !== sig[i]) return 'bad_magic_bytes'
    }
    return 'ok'
  }
  if (mimeType === 'image/svg+xml') {
    // First non-whitespace token must be <?xml or <svg (case-insensitive).
    // Scan up to the first 512 bytes; anything beyond that is unlikely to be
    // a valid SVG header.
    const head = new TextDecoder('utf-8', { fatal: false })
      .decode(bytes.subarray(0, Math.min(bytes.length, 512)))
      .replace(/^﻿/, '') // strip BOM
      .trimStart()
      .toLowerCase()
    if (head.startsWith('<?xml')) {
      const closeIdx = head.indexOf('?>')
      if (closeIdx < 0) return 'bad_magic_bytes'
      const after = head.slice(closeIdx + 2).trimStart()
      if (after.startsWith('<svg')) return 'ok'
      return 'bad_magic_bytes'
    }
    if (head.startsWith('<svg')) return 'ok'
    return 'bad_magic_bytes'
  }
  return 'bad_mime_type'
}

export async function uploadKnowledgeImage(input: {
  shopId: string
  knowledgeType: KnowledgeImageType
  bytes: Uint8Array | Blob
  mimeType: string
  upload?: StorageUploadFn
}): Promise<string> {
  const baseMime = input.mimeType.split(';')[0].trim()
  const ext = MIME_TO_EXT[baseMime] ?? 'bin'
  const key = `knowledge/${input.shopId}/${input.knowledgeType}/${randomUUID()}.${ext}`
  const upload =
    input.upload ?? ((path, body, opts) => supabase.storage.from(BUCKET).upload(path, body, opts))
  const { error } = await upload(key, input.bytes, {
    contentType: input.mimeType,
    upsert: false,
  })
  if (error) throw new Error(`upload failed: ${error.message}`)
  return key
}

export async function knowledgeImageSignedUrl(
  storageKey: string,
  expiresInSec = 3600,
  opts: { createSignedUrl?: StorageCreateSignedUrlFn } = {},
): Promise<string> {
  const createSignedUrl =
    opts.createSignedUrl ??
    ((path, secs) => supabase.storage.from(BUCKET).createSignedUrl(path, secs))
  const { data, error } = await createSignedUrl(storageKey, expiresInSec)
  if (error || !data) throw new Error(`signed url failed: ${error?.message ?? 'no data'}`)
  return data.signedUrl
}
