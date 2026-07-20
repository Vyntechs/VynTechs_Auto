export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; error: 'invalid_json' | 'payload_too_large' }

/** Reads an actual request stream without materializing more than `maxBytes`. */
export async function readBoundedJson(req: Request, maxBytes: number): Promise<BoundedJsonResult> {
  const declaredLength = req.headers.get('content-length')
  if (declaredLength && Number.isSafeInteger(Number(declaredLength)) && Number(declaredLength) > maxBytes) {
    return { ok: false, error: 'payload_too_large' }
  }
  if (!req.body) return { ok: false, error: 'invalid_json' }

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return { ok: false, error: 'payload_too_large' }
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  } catch {
    return { ok: false, error: 'invalid_json' }
  } finally {
    reader.releaseLock()
  }
}
