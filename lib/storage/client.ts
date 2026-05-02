import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

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

export async function uploadArtifact(input: {
  sessionId: string
  kind: 'photo' | 'video' | 'audio' | 'scan_screen' | 'wiring_diagram'
  bytes: Uint8Array | Blob
  mimeType: string
}): Promise<string> {
  const ext = EXTENSION[input.mimeType] ?? 'bin'
  const key = `${input.sessionId}/${input.kind}/${randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(key, input.bytes, { contentType: input.mimeType, upsert: false })
  if (error) throw new Error(`upload failed: ${error.message}`)
  return key
}

export async function signedUrl(storageKey: string, expiresInSec = 3600): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storageKey, expiresInSec)
  if (error || !data) throw new Error(`signed url failed: ${error?.message ?? 'no data'}`)
  return data.signedUrl
}

export async function downloadArtifact(storageKey: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(BUCKET).download(storageKey)
  if (error || !data) throw new Error(`download failed: ${error?.message ?? 'no data'}`)
  const buf = await data.arrayBuffer()
  return new Uint8Array(buf)
}
