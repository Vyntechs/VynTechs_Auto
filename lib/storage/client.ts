import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

// ---------------------------------------------------------------------------
// Lazy-Proxy client (mirrors lib/stripe.ts).
// ---------------------------------------------------------------------------

let _client: SupabaseClient | undefined

function getClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    )
  }
  return _client
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getClient()
    const value = Reflect.get(client, prop, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

const BUCKET = 'artifacts'

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'video/webm': 'webm',
  'video/mp4': 'mp4',
}

// ---------------------------------------------------------------------------
// Injectable function types — mirror lib/stripe.ts createCustomer? pattern.
// ---------------------------------------------------------------------------

export type StorageUploadFn = (
  path: string,
  body: Uint8Array | Blob,
  options: { contentType: string; upsert: boolean },
) => Promise<{ data: { path: string } | null; error: { message: string } | null }>

export type StorageCreateSignedUrlFn = (
  path: string,
  expiresInSec: number,
) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>

export type StorageDownloadFn = (
  path: string,
) => Promise<{ data: Blob | null; error: { message: string } | null }>

export type StorageRemoveFn = (
  paths: string[],
) => Promise<{ data: unknown; error: { message: string } | null }>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function uploadArtifact(input: {
  sessionId: string
  kind: 'photo' | 'video' | 'audio' | 'scan_screen' | 'wiring_diagram'
  bytes: Uint8Array | Blob
  mimeType: string
  upload?: StorageUploadFn
}): Promise<string> {
  const baseMime = input.mimeType.split(';')[0].trim()
  const ext = EXTENSION[baseMime] ?? 'bin'
  const key = `${input.sessionId}/${input.kind}/${randomUUID()}.${ext}`
  const upload =
    input.upload ??
    ((path, body, opts) => supabase.storage.from(BUCKET).upload(path, body, opts))
  const { error } = await upload(key, input.bytes, {
    contentType: input.mimeType,
    upsert: false,
  })
  if (error) throw new Error(`upload failed: ${error.message}`)
  return key
}

export async function signedUrl(
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

export async function downloadArtifact(
  storageKey: string,
  opts: { download?: StorageDownloadFn } = {},
): Promise<Uint8Array> {
  const download =
    opts.download ?? ((path) => supabase.storage.from(BUCKET).download(path))
  const { data, error } = await download(storageKey)
  if (error || !data) throw new Error(`download failed: ${error?.message ?? 'no data'}`)
  const buf = await data.arrayBuffer()
  return new Uint8Array(buf)
}

export async function uploadJobAttachment(input: {
  storageKey: string
  bytes: Uint8Array
  mimeType: string
  upload?: StorageUploadFn
}): Promise<void> {
  const upload = input.upload
    ?? ((path, body, opts) => supabase.storage.from(BUCKET).upload(path, body, opts))
  const { error } = await upload(input.storageKey, input.bytes, {
    contentType: input.mimeType,
    upsert: true,
  })
  if (error) throw new Error(`job attachment upload failed: ${error.message}`)
}

export async function removeJobAttachment(
  storageKey: string,
  opts: { remove?: StorageRemoveFn } = {},
): Promise<void> {
  const remove = opts.remove ?? ((paths) => supabase.storage.from(BUCKET).remove(paths))
  const { error } = await remove([storageKey])
  if (error) throw new Error(`job attachment removal failed: ${error.message}`)
}

export async function downloadJobAttachment(
  storageKey: string,
  opts: { download?: StorageDownloadFn } = {},
): Promise<Uint8Array> {
  return downloadArtifact(storageKey, opts)
}
